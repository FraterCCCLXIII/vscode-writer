/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ActivityBarPosition, LayoutSettings } from '../../../services/layout/browser/layoutService.js';
import { ChatConfiguration } from '../common/constants.js';
import { ChatViewContainerId } from './chat.js';

/**
 * When {@link ChatConfiguration.ViewTitleToolbarCompactNewChatOnly} is on and the Chat view
 * container is active in the secondary side bar, maximize/close are moved off the primary strip
 * into the ⋯ overflow (see gated registrations in auxiliaryBarActions.ts).
 */
const compactChatAuxiliaryTitleWhen = ContextKeyExpr.and(
	ContextKeyExpr.equals(`config.${ChatConfiguration.ViewTitleToolbarCompactNewChatOnly}`, true),
	ContextKeyExpr.equals('activeAuxiliary', ChatViewContainerId),
);

MenuRegistry.appendMenuItem(MenuId.AuxiliaryBarTitle, {
	command: {
		id: 'workbench.action.toggleMaximizedAuxiliaryBar',
		title: localize('toggleMaximizedAuxiliaryBar', 'Toggle Maximized Secondary Side Bar'),
		icon: Codicon.screenFull,
	},
	group: 'overflow',
	order: 1,
	when: compactChatAuxiliaryTitleWhen,
});

MenuRegistry.appendMenuItem(MenuId.AuxiliaryBarTitle, {
	command: {
		id: 'workbench.action.toggleAuxiliaryBar',
		title: localize('closeSecondarySideBar', 'Hide Secondary Side Bar'),
		icon: Codicon.close,
	},
	group: 'overflow',
	order: 2,
	when: ContextKeyExpr.and(
		compactChatAuxiliaryTitleWhen,
		ContextKeyExpr.equals(`config.${LayoutSettings.ACTIVITY_BAR_LOCATION}`, ActivityBarPosition.DEFAULT),
	),
});
