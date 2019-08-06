//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { LocalExtensionKeyProvider } from './localExtensionKeyProvider';
import { LocalExtensionKey } from './localExtensionKey';
import { IEntityMetadataProvider } from '../../lib/entityMetadataProvider/entityMetadataProvider';

export interface ILocalExtensionKeyProvider {
  initialize(): Promise<void>;

  getForCorporateId(corporateId: string): Promise<LocalExtensionKey>;
  createNewForCorporateId(localExtensionKey: LocalExtensionKey): Promise<void>;
  updateForCorporateId(localExtensionKey: LocalExtensionKey): Promise<void>;
  delete(localExtensionKey: LocalExtensionKey): Promise<void>;
}

export interface ILocalExtensionKeyProviderOptions {
  entityMetadataProvider: IEntityMetadataProvider;
}

export async function CreateLocalExtensionKeyProvider(options: ILocalExtensionKeyProviderOptions): Promise<ILocalExtensionKeyProvider> {
  const provider = new LocalExtensionKeyProvider(options);
  await provider.initialize();
  return provider;
}
