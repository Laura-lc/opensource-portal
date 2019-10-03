//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { IndividualContext, IIndividualContextOptions, IWebContextOptions, WebContext, SessionUserProperties, WebApiContext } from '../../user';
import { Operations } from '../../business/operations';

export function webContextMiddleware(req, res, next) {
  const operations = req.app.settings.providers.operations as Operations;

  if (req.apiContext) {
    const msg = 'INVALID: API and web contexts should not be mixed';
    console.warn(msg);
    return next(new Error(msg));
  }

  if (req.individualContext) {
    console.warn('DUPLICATE EFFORT: middleware has already created the individual context');
    return next();
  }

  const webContextOptions: IWebContextOptions = {
    baseUrl: '/',
    request: req,
    response: res,
    // LATER: session provider
    // LATER: settings
    sessionUserProperties: new SessionUserProperties(req.user),
  };
  const webContext = new WebContext(webContextOptions);

  const insights = req.app.settings.providers.insights;

  const options : IIndividualContextOptions = {
    corporateIdentity: null,
    link: null,
    insights,
    operations,
    webApiContext: null,
    webContext,
  };
  const individualContext = new IndividualContext(options);
  req.individualContext = individualContext;

  return next();
};

export function apiContextMiddleware(req, res, next) {
  const operations = req.app.settings.providers.operations as Operations;

  if (req.individualContext) {
    const msg = 'INVALID: API and web contexts should not be mixed';
    console.warn(msg);
    return next(new Error(msg));
  }

  const webApiContext = new WebApiContext();

  const insights = req.app.settings.providers.insights;

  const options : IIndividualContextOptions = {
    corporateIdentity: null,
    link: null,
    insights,
    operations,
    webApiContext,
    webContext: null,
  };
  const individualContext = new IndividualContext(options);
  req.apiContext = individualContext;

  return next();
};
