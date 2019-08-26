//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { InnerError, ReposAppRequest, IReposAppResponse } from "../transitional";

import { ICorporateLinkProperties, ICorporateLink, ICorporateLinkExtended, ICorporateLinkExtendedDirectMethods } from './corporateLink';

import { addBreadcrumb, wrapError } from '../utils';
import { Operations } from "./operations";
import { GitHubTeamRole } from "./team";

const objectPath = require('object-path');

// - - - identity

export enum GitHubIdentitySource {
  Link,
  Session,
}

export interface IGitHubIdentity {
  id: string;
  username: string;
  avatar?: string;
  displayName?: string;

  source: GitHubIdentitySource;
}

export interface ICorporateIdentity {
  id: string;
  username: string;
  displayName?: string;
}

// - - - web

export interface IWebContextOptions {
  baseUrl?: string;
  request: ReposAppRequest;
  response: IReposAppResponse;
  sessionUserProperties: SessionUserProperties;
}

export interface IWebPageRenderOptions {
  title?: string;
  view: string;

  state?: any;
  optionalObject?: any;
}

// legacy structure
interface IWebPageRenderUser {
  primaryAuthenticationScheme: string;
  primaryUsername: string;
  githubSignout: string;
  azureSignout: string;
  github?: {
    id?: string;
    username?: string;
    displayName?: string;
    avatarUrl?: string;
    accessToken?: boolean;
    increasedScope?: boolean;
  },
  azure?: {
    username: string;
    displayName?: string;
  }
}

export class SessionUserProperties {
  private _sessionUserProperties: any;

  constructor(sessionEntityReference: any) {
    this._sessionUserProperties = sessionEntityReference;
  }

  getValue(keyPath: string): string {
    return objectPath.get(this._sessionUserProperties, keyPath);
  }

  setValue(keyPath: string, value: string): boolean {
    return objectPath.set(this._sessionUserProperties, keyPath, value);
  }
}

export interface IReposGitHubTokens {
  gitHubReadToken: string;
  gitHubWriteOrganizationToken: string;
}

class ReposGitHubTokensSessionAdapter implements IReposGitHubTokens {
  private _sessionUserProperties: SessionUserProperties;

  constructor(sessionUserProperties: SessionUserProperties) {
    this._sessionUserProperties = sessionUserProperties;
  }

  get gitHubReadToken(): string {
    return this._sessionUserProperties.getValue('github.accessToken');
  }

  get gitHubWriteOrganizationToken(): string {
    return this._sessionUserProperties.getValue('githubIncreasedScope.accessToken');
  }
}

export class WebApiContext {
  constructor() {
  }
}

export class WebContext {
  private _baseUrl: string;
  private _request: ReposAppRequest;
  private _response: IReposAppResponse;
  private _sessionUserProperties: SessionUserProperties;
  private _tokens: ReposGitHubTokensSessionAdapter;

  constructor(options: IWebContextOptions) {
    this._baseUrl = options.baseUrl || '/';
    this._request = options.request;
    this._response = options.response;
    this._sessionUserProperties = options.sessionUserProperties;

    this._tokens = new ReposGitHubTokensSessionAdapter(this._sessionUserProperties);
  }

  get baseUrl(): string {
    return this._baseUrl;
  }

  get tokens(): ReposGitHubTokensSessionAdapter {
    return this._tokens;
  }

  pushBreadcrumb(title: string, optionalLink?: string | boolean): void {
    const req = this._request;
    addBreadcrumb(req, title, optionalLink);
  }

  // NOTE: This function is direct from the legacy provider... it could move to
  // a dedicated alert provider or something else in the future.
  saveUserAlert(message, title, context, optionalLink?, optionalCaption?) {
    if (typeof (message) !== 'string') {
      console.warn('First parameter message should be a string, not an object. Was the request object passed through by accident?');
      throw new Error('First parameter message should be a string, not an object. Was the request object passed through by accident?');
    }
    // ----------------------------------------------------------------------------
    // Helper function for UI: Store in the user's session an alert message or
    // action to be shown in another successful render. Contexts come from Twitter
    // Bootstrap, i.e. 'success', 'info', 'warning', 'danger'.
    // ----------------------------------------------------------------------------
    const alert = {
      message: message,
      title: title || 'FYI',
      context: context || 'success',
      optionalLink: optionalLink,
      optionalCaption: optionalCaption,
    };
    const session = this._request['session'];
    if (session) {
      if (session.alerts && session.alerts.length) {
        session.alerts.push(alert);
      } else {
        session.alerts = [
          alert,
        ];
      }
    }
  }

  render(options: IWebPageRenderOptions) {
    if (!this._request) {
      throw new Error('No request available');
    }
    if (!this._response) {
      throw new Error('No request available');
    }

    const individualContext = this._request.individualContext;

    const { view, title, optionalObject, state } = options;

    let viewState = state || optionalObject;
    if (state && optionalObject) {
      throw new Error('Both state and optionalObject cannot be provided to a view render method');
    }

    // LEGACY: this whole section
    const breadcrumbs = this._request['breadcrumbs'];
    if (breadcrumbs && breadcrumbs.length && breadcrumbs.length > 0) {
      breadcrumbs[breadcrumbs.length - 1].isLast = true;
    }
    const authScheme = 'aad';
    const user: IWebPageRenderUser = {
      primaryAuthenticationScheme: authScheme,
      primaryUsername: individualContext.corporateIdentity ? individualContext.corporateIdentity.username : null,
      githubSignout: '/signout/github',
      azureSignout: '/signout',
    };
    // TODO: if the user hasn't linked, we need to access their session/individual context's github identity here!
    const gitHubIdentity = individualContext.getGitHubIdentity();
    if (gitHubIdentity) {
      user.github = {
        id: gitHubIdentity.id,
        username: gitHubIdentity.username,
        displayName: gitHubIdentity.displayName,
        avatarUrl: gitHubIdentity.avatar,
        // OLD: accessToken; this is no longer stored
        increasedScope: individualContext.hasGitHubOrganizationWriteToken(),
      };
    }
    if (individualContext.corporateIdentity) {
      user.azure = {
        username: individualContext.corporateIdentity.username,
        displayName: individualContext.corporateIdentity.displayName,
      };
    }
    const reposContext = this._request.reposContext || {
      section: 'orgs',
      organization: this._request.organization,
    };
    const config = this._request.app.settings['runtimeConfig'];
    if (!config) {
      throw new Error('runtimeConfig is missing');
    }
    const simulatedLegacyLink = individualContext.link ? {
      aadupn: user.azure ? user.azure.username : null,
      ghu: user.github ? user.github.username : null,
    } : null;
    let session = this._request['session'] || null;
    const obj = {
      title,
      config,
      serviceBanner: config.serviceMessage ? config.serviceMessage.banner : null,
      user,
      // DESTROY: CONFIRM once 'ossline' is gone this way
      ossLink: simulatedLegacyLink,
      showBreadcrumbs: true,
      breadcrumbs,
      sudoMode: this._request['sudoMode'],
      view,
      site: 'github',
      enableMultipleAccounts: session ? session['enableMultipleAccounts'] : false,
      reposContext: undefined,
      alerts: undefined,
    };
    if (obj.ossLink && reposContext) {
      obj.reposContext = reposContext;
    }
    if (viewState) {
      Object.assign(obj, viewState);
    }
    if (session && session['alerts'] && session['alerts'].length) {
      const alerts = [];
      Object.assign(alerts, session['alerts']);
      session['alerts'] = [];
      for (let i = 0; i < alerts.length; i++) {
        if (typeof alerts[i] == 'object') {
          alerts[i].number = i + 1;
        }
      }
      obj.alerts = alerts;
    }
    return this._response.render(view, obj);
    // ANCIENT: RESTORE A GOOD CALL HERE!
  /*
    if (reposContext && !reposContext.availableOrganizations) {
      this.getMyOrganizations((getMyOrgsError, organizations) => {
        if (!getMyOrgsError && organizations && Array.isArray(organizations)) {
          reposContext.availableOrganizations = organizations;
          res.render(view, obj);
        }
      });
    } else {
      res.render(view, obj);
    }
    */
  }
}

// - - - individual context

export interface IIndividualContextOptions {
  corporateIdentity: ICorporateIdentity;
  link: ICorporateLink | null | undefined;
  insights: any;
  webApiContext: WebApiContext | null | undefined;
  webContext: WebContext | null | undefined;
  operations: Operations;
}

export class IndividualContext {
  private _corporateIdentity: ICorporateIdentity;
  private _sessionBasedGitHubIdentity: IGitHubIdentity;
  private _link: ICorporateLink;
  private _webContext: WebContext;
  private _isPortalAdministrator: boolean | null;
  private _operations: Operations;

  constructor(options: IIndividualContextOptions) {
    this._isPortalAdministrator = null;
    this._corporateIdentity = options.corporateIdentity;
    this._link = options.link;
    this._webContext = options.webContext;
    this._operations = options.operations;
  }

  get corporateIdentity(): ICorporateIdentity {
    return this._corporateIdentity;
  }

  set corporateIdentity(value: ICorporateIdentity) {
    if (this._corporateIdentity) {
      throw new Error('The context already has a corporate identity set');
    }
    this._corporateIdentity = value;
  }

  get link(): ICorporateLink {
    return this._link;
  }

  set link(value: ICorporateLink) {
    if (this._link) {
      throw new Error('The context already has had a link set');
    }
    this._link = value;
  }

  get webContext(): WebContext {
    return this._webContext;
  }

  hasGitHubOrganizationWriteToken() : boolean {
    return false;
  }

  getGitHubIdentity(): IGitHubIdentity {
    if (this._link) {
      return {
        id: this._link.thirdPartyId,
        username: this._link.thirdPartyUsername,
        avatar: this._link.thirdPartyAvatar,
        source: GitHubIdentitySource.Link,
      };
    } else if (this._sessionBasedGitHubIdentity) {
      return this._sessionBasedGitHubIdentity;
    }
    return null;
  }

  getSessionBasedGitHubIdentity() {
    return this._sessionBasedGitHubIdentity;
  }

  setSessionBasedGitHubIdentity(identity: IGitHubIdentity) {
    this._sessionBasedGitHubIdentity = identity;
  }

  createGitHubLinkObject() : ICorporateLink {
    const corporateIdentity = this._corporateIdentity;
    if (!corporateIdentity) {
      throw new Error('Cannot create a link: no corporate identity');
    }

    const gitHubIdentity = this.getGitHubIdentity();
    if (!gitHubIdentity) {
      throw new Error('Cannot create a link: no corporate identity');
    }

    const newLink : ICorporateLink = {
      thirdPartyAvatar: gitHubIdentity.avatar,
      thirdPartyId: gitHubIdentity.id,
      thirdPartyUsername: gitHubIdentity.username,
      corporateId: corporateIdentity.id,
      corporateUsername: corporateIdentity.username,
      corporateDisplayName: corporateIdentity.displayName,
      isServiceAccount: false,
      serviceAccountMail: undefined,
    };
    return newLink;
  }

  async isPortalAdministrator(): Promise<boolean> {
    const operations = this._operations;
    const ghi = this.getGitHubIdentity().username;
    const isAdmin = await legacyCallbackIsPortalAdministrator(operations, ghi);
    this._isPortalAdministrator = isAdmin;
    return this._isPortalAdministrator;
  }
}

async function legacyCallbackIsPortalAdministrator(operations: Operations, gitHubUsername: string): Promise<boolean> {
  const config = operations.config;
  // ----------------------------------------------------------------------------
  // SECURITY METHOD:
  // Determine whether the authenticated user is an Administrator of the org. At
  // this time there is a special "portal sudoers" team that is used. The GitHub
  // admin flag is not used [any longer] for performance reasons to reduce REST
  // calls to GitHub.
  // ----------------------------------------------------------------------------
  if (config.github.debug && config.github.debug.portalSudoOff) {
    console.warn('DEBUG WARNING: Portal sudo support is turned off in the current environment');
    return false;
  }

  if (config.github.debug && config.github.debug.portalSudoForce) {
    console.warn('DEBUG WARNING: Portal sudo is turned on for all users in the current environment');
    return true;
  }

  /*
  var self = this;
  if (self.entities && self.entities.primaryMembership) {
      var pm = self.entities.primaryMembership;
      if (pm.role && pm.role === 'admin') {
          return callback(null, true);
      }
  }
  */
  const primaryName = operations.getOrganizationOriginalNames()[0];
  const primaryOrganization = operations.getOrganization(primaryName);
  const sudoTeam = primaryOrganization.systemSudoersTeam;
  if (!sudoTeam) {
    return false;
  }
  try {
    const isMember = await sudoTeam.isMember(gitHubUsername);
    return (isMember === true || isMember === GitHubTeamRole.Member || isMember === GitHubTeamRole.Maintainer);
  } catch (error) {
    throw wrapError(error, 'We had trouble querying GitHub for important team management information. Please try again later or report this issue.');
  }
}
