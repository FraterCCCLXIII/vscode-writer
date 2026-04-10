/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { MenuRegistry, MenuId } from '../../../../platform/actions/common/actions.js';
import { Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IsSessionsWindowContext } from '../../../common/contextkeys.js';
import { LayoutSettings } from '../../../services/layout/browser/layoutService.js';

/**
 * Writer product defaults and View menu entries. Not an extension — not listed in Extensions
 * and not user-disableable; keeps fork merges simpler than a separate extension package.
 */
Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerDefaultConfigurations([{
	overrides: {
		'workbench.statusBar.visible': false,
		[LayoutSettings.ACTIVITY_BAR_COMPACT]: true,
		'breadcrumbs.enabled': false,
		'workbench.tree.renderIndentGuides': 'none',
		'workbench.iconTheme': 'vscode-writer-lucide',
	},
	source: 'writer-ui',
}]);

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
	group: '2_appearance',
	order: 3,
	when: IsSessionsWindowContext.negate(),
	command: {
		id: 'workbench.action.toggleStatusbarVisibility',
		title: localize2('toggleStatusbar', "Toggle Status Bar Visibility"),
		toggled: {
			condition: ContextKeyExpr.equals('config.workbench.statusBar.visible', true),
			title: localize('statusBar', "Status Bar"),
			mnemonicTitle: localize({ key: 'miStatusbar', comment: ['&& denotes a mnemonic'] }, "S&&tatus Bar"),
		},
	},
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
	group: '2_appearance',
	order: 4,
	when: IsSessionsWindowContext.negate(),
	command: {
		id: 'breadcrumbs.toggle',
		title: localize2('cmd.toggle', "Toggle Breadcrumbs"),
		toggled: {
			condition: ContextKeyExpr.equals('config.breadcrumbs.enabled', true),
			title: localize('cmd.toggle2', "Breadcrumbs"),
			mnemonicTitle: localize({ key: 'miBreadcrumbs2', comment: ['&& denotes a mnemonic'] }, "&&Breadcrumbs"),
		},
	},
});
