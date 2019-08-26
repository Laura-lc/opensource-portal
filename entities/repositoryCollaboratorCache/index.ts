//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { RepositoryCollaboratorCacheProvider, IRepositoryCollaboratorCacheCreateOptions, IRepositoryCollaboratorCacheProvider } from './repositoryCollaboratorCacheProvider';

export async function CreateRepositoryCollaboratorCacheProviderInstance(options?: IRepositoryCollaboratorCacheCreateOptions): Promise<IRepositoryCollaboratorCacheProvider> {
  const provider = new RepositoryCollaboratorCacheProvider(options);
  await provider.initialize();
  return provider;
}
