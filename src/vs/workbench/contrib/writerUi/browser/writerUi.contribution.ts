/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuRegistry, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { VIEWLET_ID } from '../../debug/common/debug.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { InEditorZenModeContext, IsSessionsWindowContext } from '../../../common/contextkeys.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ViewContainerLocation } from '../../../common/views.js';
import { EditorTabsMode, LayoutSettings } from '../../../services/layout/browser/layoutService.js';
import { workbenchConfigurationNodeBase } from '../../../common/configuration.js';

const SHOW_RUN_DEBUG_ACTIVITY_KEY = 'workbench.writer.showRunAndDebug';
const PINNED_VIEWLETS_KEY = 'workbench.activity.pinnedViewlets2';
const VIEWLETS_WORKSPACE_STATE_KEY = 'workbench.activity.viewletsWorkspaceState';

/**
 * Writer product defaults and View menu entries. Not an extension — not listed in Extensions
 * and not user-disableable; keeps fork merges simpler than a separate extension package.
 */
Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
	...workbenchConfigurationNodeBase,
	properties: {
		[SHOW_RUN_DEBUG_ACTIVITY_KEY]: {
			type: 'boolean',
			default: false,
			description: localize('writer.showRunAndDebug', "When enabled, shows the Run and Debug icon in the activity bar. You can still open Run and Debug from the menu bar or Command Palette when this is off."),
		},
	},
});

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

registerAction2(class ToggleRunAndDebugActivityBarAction extends Action2 {
	static readonly ID = 'workbench.action.writer.toggleRunAndDebugActivityBar';

	constructor() {
		super({
			id: ToggleRunAndDebugActivityBarAction.ID,
			title: localize2('writer.toggleRunAndDebugActivity', "Run && Debug in Activity Bar"),
			category: Categories.View,
			f1: true,
			precondition: IsSessionsWindowContext.negate(),
			toggled: {
				condition: ContextKeyExpr.equals(`config.${SHOW_RUN_DEBUG_ACTIVITY_KEY}`, true),
				title: localize('runAndDebugActivity', "Run && Debug"),
				mnemonicTitle: localize({ key: 'miRunAndDebugActivity', comment: ['&& denotes a mnemonic'] }, "Run && Debug"),
			},
			menu: [{
				id: MenuId.MenubarViewMenu,
				group: '2_appearance',
				order: 2,
				when: IsSessionsWindowContext.negate(),
			}],
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);
		const current = configurationService.getValue<boolean>(SHOW_RUN_DEBUG_ACTIVITY_KEY) ?? false;
		return configurationService.updateValue(SHOW_RUN_DEBUG_ACTIVITY_KEY, !current);
	}
});

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

const editorTabsVisibleContext = ContextKeyExpr.notEquals(`config.${LayoutSettings.EDITOR_TABS_MODE}`, EditorTabsMode.NONE);

registerAction2(class ToggleOpenEditorTabsAction extends Action2 {
	static readonly ID = 'workbench.action.toggleOpenEditorTabs';

	constructor() {
		super({
			id: ToggleOpenEditorTabsAction.ID,
			title: localize2('toggleOpenEditorTabs', "Open Editor Tabs"),
			category: Categories.View,
			f1: true,
			precondition: ContextKeyExpr.and(IsSessionsWindowContext.negate(), InEditorZenModeContext.negate()),
			toggled: {
				condition: editorTabsVisibleContext,
				title: localize('openEditorTabsMenuTitle', "Open Editor Tabs"),
				mnemonicTitle: localize({ key: 'miOpenEditorTabs', comment: ['&& denotes a mnemonic'] }, "Open &&Editor Tabs"),
			},
			menu: [{
				id: MenuId.MenubarViewMenu,
				group: '2_appearance',
				order: 5,
				when: ContextKeyExpr.and(IsSessionsWindowContext.negate(), InEditorZenModeContext.negate()),
			}],
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);
		const current = configurationService.getValue<string>(LayoutSettings.EDITOR_TABS_MODE);
		const next = current === EditorTabsMode.NONE ? EditorTabsMode.MULTIPLE : EditorTabsMode.NONE;
		return configurationService.updateValue(LayoutSettings.EDITOR_TABS_MODE, next);
	}
});

interface IPinnedViewContainerState {
	readonly id: string;
	readonly pinned: boolean;
	readonly order?: number;
	readonly visible: boolean;
}

interface IViewContainerWorkspaceStateEntry {
	readonly id: string;
	readonly visible: boolean;
}

function applyRunAndDebugActivityVisibility(storageService: IStorageService, show: boolean): void {
	const pinnedRaw = storageService.get(PINNED_VIEWLETS_KEY, StorageScope.PROFILE, '[]');
	let pinned: IPinnedViewContainerState[] = [];
	try {
		pinned = JSON.parse(pinnedRaw) as IPinnedViewContainerState[];
	} catch {
		pinned = [];
	}
	const idx = pinned.findIndex(p => p.id === VIEWLET_ID);
	if (idx >= 0) {
		pinned[idx] = { ...pinned[idx], visible: show };
	} else {
		pinned.push({ id: VIEWLET_ID, pinned: true, visible: show });
	}
	storageService.store(PINNED_VIEWLETS_KEY, JSON.stringify(pinned), StorageScope.PROFILE, StorageTarget.USER);

	const workspaceRaw = storageService.get(VIEWLETS_WORKSPACE_STATE_KEY, StorageScope.WORKSPACE, '[]');
	let workspaceState: IViewContainerWorkspaceStateEntry[] = [];
	try {
		workspaceState = JSON.parse(workspaceRaw) as IViewContainerWorkspaceStateEntry[];
	} catch {
		workspaceState = [];
	}
	const wi = workspaceState.findIndex(w => w.id === VIEWLET_ID);
	if (show) {
		if (wi >= 0) {
			workspaceState.splice(wi, 1);
		}
	} else {
		if (wi >= 0) {
			workspaceState[wi] = { id: VIEWLET_ID, visible: false };
		} else {
			workspaceState.push({ id: VIEWLET_ID, visible: false });
		}
	}
	storageService.store(VIEWLETS_WORKSPACE_STATE_KEY, JSON.stringify(workspaceState), StorageScope.WORKSPACE, StorageTarget.MACHINE);
}

class WriterRunAndDebugActivityContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.writerRunAndDebugActivity';

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IViewsService private readonly viewsService: IViewsService,
	) {
		super();
		const scheduleApply = () => {
			if (this.environmentService.isSessionsWindow) {
				return;
			}
			const show = this.configurationService.getValue<boolean>(SHOW_RUN_DEBUG_ACTIVITY_KEY) ?? false;
			applyRunAndDebugActivityVisibility(this.storageService, show);
		};
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(SHOW_RUN_DEBUG_ACTIVITY_KEY)) {
				scheduleApply();
			}
		}));
		// Opening Run and Debug (including session restore) runs PaneCompositeBar.onDidViewContainerVisible,
		// which calls addComposite() and forces the activity icon visible again, then saveCachedViewContainers
		// persists visible:true. Re-apply after that synchronous path so the icon stays hidden when desired.
		this._register(this.viewsService.onDidChangeViewContainerVisibility(e => {
			if (e.id !== VIEWLET_ID || e.location !== ViewContainerLocation.Sidebar || !e.visible) {
				return;
			}
			if (this.environmentService.isSessionsWindow) {
				return;
			}
			if (this.configurationService.getValue<boolean>(SHOW_RUN_DEBUG_ACTIVITY_KEY) ?? false) {
				return;
			}
			queueMicrotask(() => scheduleApply());
		}));
		// Apply after extensions are registered so we run after PaneCompositeBar's
		// onDidRegisterExtensions(), which re-shows all non-empty view containers and
		// registers the storage-change listener we depend on.
		this.extensionService.whenInstalledExtensionsRegistered().then(() => scheduleApply());
	}
}

registerWorkbenchContribution2(WriterRunAndDebugActivityContribution.ID, WriterRunAndDebugActivityContribution, WorkbenchPhase.AfterRestored);
