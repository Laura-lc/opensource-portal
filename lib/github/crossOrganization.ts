//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

'use strict';

import async = require('async');
import Q from 'q';
import { IIntelligentCacheObjectResponse, IIntelligentCacheResponseArray, createCallbackFlattenData } from './core';
import { CompositeApiContext } from './composite';
import { ILibraryContext } from '.';

interface IOrganizationsResponse extends IIntelligentCacheObjectResponse {
  orgs?: any;
}

interface ICrossOrganizationDataResponse extends IIntelligentCacheObjectResponse {
  data?: any;
}

interface ILocalOptionsParameters {
  per_page: number;
  id?: string;
  team_id?: string;
  owner?: string;
  repo?: string;
}

function createMethods(libraryContext: ILibraryContext, collectionsClient) {
  function generalizedCollectionMethod(token, apiName, method, options, cacheOptions, callback) {
    if (callback === undefined && typeof (cacheOptions) === 'function') {
      callback = cacheOptions;
      cacheOptions = {};
    }
    const apiContext = new CompositeApiContext(apiName, method, options);
    apiContext.maxAgeSeconds = cacheOptions.maxAgeSeconds || 600;
    apiContext.overrideToken(token);
    apiContext.libraryContext = libraryContext;
    if (cacheOptions.backgroundRefresh) {
      apiContext.backgroundRefresh = true;
    }
    return libraryContext.compositeEngine.execute(apiContext).then(ok => {
      return callback(null, ok);
    }, callback);
  }

  function getCrossOrganizationMethod(orgsAndTokens, apiName, methodName, options, cacheOptions, callback) {
    const method = collectionsClient[methodName];
    if (!method) {
      throw new Error(`No method called ${method} defined in the collections client.`);
    }
    const crossOrgMethod = function actualCrossOrgMethod() {
      const values: IOrganizationsResponse = {};
      values.headers = {};
      values.orgs = {};
      const deferred = Q.defer();
      async.eachOfLimit(orgsAndTokens, 1, (token, orgName, next) => {
        const localOptions = Object.assign({}, options);
        localOptions.org = orgName;
        if (!localOptions.per_page) {
          localOptions.per_page = 100;
        }
        const localCacheOptions = Object.assign({}, cacheOptions);
        if (localCacheOptions.individualMaxAgeSeconds) {
          localCacheOptions.maxAgeSeconds = localCacheOptions.individualMaxAgeSeconds;
        }
        method(token, localOptions, localCacheOptions, (orgError, orgValues) => {
          if (orgError) {
            return next(orgError);
          }
          if (!orgValues) {
            return next(new Error('No result'));
          }
          if (orgValues && orgValues.data) {
            console.warn(`${apiName} ${methodName} result has data that is being used instead of the parent object`);
            values.orgs[orgName] = orgValues.data;
            return next();
          }
          values.orgs[orgName] = orgValues;
          return next();
        });
      }, (error) => {
        if (error) {
          return deferred.reject(error);
        }
        const dataObject = {
          data: values,
          headers: values.headers,
        };
        delete values.headers;
        deferred.resolve(dataObject);
      });
      return deferred.promise;
    };
    return generalizedCollectionMethod(orgsAndTokens, apiName, crossOrgMethod, options, cacheOptions, callback);
  }

  function crossOrganizationCollection(orgsAndTokens, options, cacheOptions, innerKeyType, outerFunction, collectionMethodName, collectionKey, optionalSetOrganizationLogin) {
    return () => {
      const deferred = Q.defer();
      const entities: IIntelligentCacheResponseArray = [];
      entities.headers = {};
      outerFunction(orgsAndTokens, {}, cacheOptions, (outerError, data) => {
        let entitiesByOrg = null;
        if (!outerError && data && !data.data) {
          outerError = new Error('crossOrganizationCollection inner outerFunction returned an entity but no entity.data property was present');
        } else if (!outerError && data && data.data) {
          entitiesByOrg = data.data;
        }
        if (outerError) {
          return deferred.reject(outerError);
        }
        const localCacheOptions = Object.assign({}, cacheOptions);
        if (localCacheOptions.individualMaxAgeSeconds) {
          localCacheOptions.maxAgeSeconds = localCacheOptions.individualMaxAgeSeconds;
        }
        entities.headers = {};
        async.eachLimit(Object.getOwnPropertyNames(entitiesByOrg.orgs), 1, (orgName, nextOrg) => {
          const orgEntities = entitiesByOrg.orgs[orgName];
          async.eachLimit(orgEntities, 1, (orgEntity: any, next) => {
            const cloneTarget = optionalSetOrganizationLogin ? {
              organization: {
                login: orgName,
              }
            } : {};
            const entityClone = Object.assign(cloneTarget, orgEntity);
            const localOptionsTarget: ILocalOptionsParameters = {
              per_page: 100,
            };
            switch (innerKeyType) {
            case 'team':
              localOptionsTarget.team_id = orgEntity.id;
              break;
            case 'repo':
              localOptionsTarget.owner = orgName;
              localOptionsTarget.repo = orgEntity.name;
              break;
            default:
              throw new Error(`Unsupported inner key type ${innerKeyType}`);
            }
            const localOptions = Object.assign(localOptionsTarget, options);
            delete localOptions.maxAgeSeconds;
            delete localOptions.backgroundRefresh;
            const token = orgsAndTokens[orgName.toLowerCase()];
            if (!token) {
              return next(new Error(`No token available for the org "${orgName}"`));
            }
            collectionsClient[collectionMethodName](token, localOptions, localCacheOptions, (collectionsError, innerEntities) => {
              if (!collectionsError && innerEntities && innerEntities.data) {
                collectionsError = new Error(`innerEntities.data set from the ${collectionMethodName} collection method call`);
              }
              // This is a silent error for now, because there
              // are valid scenarios, i.e. team deletion, to consider.
              // In the future, get smarter here.
              if (collectionsError) {
                return next();
              }
              entityClone[collectionKey] = innerEntities;
              entities.push(entityClone);
              return next();
            });
          }, nextOrg);
        }, (error) => {
          const projectedToDataEntity: ICrossOrganizationDataResponse = {
            data: entities,
          };
          if (entities.cost) {
            projectedToDataEntity.cost = entities.cost;
            delete entities.cost;
          }
          if (entities.headers) {
            projectedToDataEntity.headers = entities.headers;
            delete entities.headers;
          }
          return error ? deferred.reject(error) : deferred.resolve(projectedToDataEntity);
        });
      });
      return deferred.promise;
    };
  }

  function wrapToFlatten(method) {
    return function wrappedMethod(orgsAndTokens, options, cacheOptions, callback) {
      return method(orgsAndTokens, options, cacheOptions, createCallbackFlattenData(callback));
    };
  }

  function getAllTeams(orgsAndTokens, options, cacheOptions, callback) {
    options.apiTypePrefix = 'github.x#';
    return getCrossOrganizationMethod(
      orgsAndTokens,
      'teams',
      'getOrgTeams',
      options,
      cacheOptions,
      callback);
  }
  function getAllRepos(orgsAndTokens, options, cacheOptions, callback) {
    options.apiTypePrefix = 'github.x#';
    return getCrossOrganizationMethod(
      orgsAndTokens,
      'repos',
      'getOrgRepos',
      options,
      cacheOptions,
      callback);
  }

  return {
    orgMembers: function getAllMembers(orgsAndTokens, options, cacheOptions, callback) {
      options.apiTypePrefix = 'github.x#';
      return getCrossOrganizationMethod(
        orgsAndTokens,
        'orgMembers',
        'getOrgMembers',
        options,
        cacheOptions,
        createCallbackFlattenData(callback));
    },
    teams: wrapToFlatten(getAllTeams),
    teamMembers: function getAllTeamMembers(orgsAndTokens, options, cacheOptions, callback) {
      options.apiTypePrefix = 'github.x#';
      return generalizedCollectionMethod(
        orgsAndTokens,
        'teamMembers',
        crossOrganizationCollection(
          orgsAndTokens,
          options,
          cacheOptions,
          'team',
          getAllTeams,
          'getTeamMembers',
          'members',
          true),
      options,
      cacheOptions,
      createCallbackFlattenData(callback));
    },
    repos: wrapToFlatten(getAllRepos),
    repoCollaborators: function getAllRepoCollaborators(orgsAndTokens, options, cacheOptions, callback) {
      options.apiTypePrefix = 'github.x#';
      return generalizedCollectionMethod(
        orgsAndTokens,
        'repoCollaborators',
        crossOrganizationCollection(
          orgsAndTokens,
          options,
          cacheOptions,
          'repo',
          getAllRepos,
          'getRepoCollaborators',
          'collaborators',
          true),
      options,
      cacheOptions,
      createCallbackFlattenData(callback));
    },
    repoTeams: function getAllRepoTeams(orgsAndTokens, options, cacheOptions, callback) {
      options.apiTypePrefix = 'github.x#';
      return generalizedCollectionMethod(
        orgsAndTokens,
        'repoTeams',
        crossOrganizationCollection(
          orgsAndTokens,
          options,
          cacheOptions,
          'repo',
          getAllRepos,
          'getRepoTeams',
          'teams',
          true),
        options,
        cacheOptions,
        createCallbackFlattenData(callback));
    },
  };
}

module.exports = createMethods;
