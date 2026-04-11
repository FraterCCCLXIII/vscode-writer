/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BasePromptElementProps, PromptElement, PromptPiece, PromptSizing } from '@vscode/prompt-tsx';
import { TextDocumentSnapshot } from '../../../../platform/editing/common/textDocumentSnapshot';
import { ITabsAndEditorsService } from '../../../../platform/tabs/common/tabsAndEditorsService';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { getNotebookAndCellFromUri } from '../../../../util/common/notebooks';
import { isLocation } from '../../../../util/common/types';
import { Schemas } from '../../../../util/vs/base/common/network';
import { isEqual } from '../../../../util/vs/base/common/resources';
import { URI } from '../../../../util/vs/base/common/uri';
import { ChatVariablesCollection, isCustomizationsIndex, isInstructionFile, isPromptFile, isSessionReference } from '../../../prompt/common/chatVariablesCollection';
import { CurrentEditor } from './currentEditor';
import { CurrentSelection } from './currentSelection';

export interface PanelEditorSelectionContextProps extends BasePromptElementProps {
	readonly chatVariables: ChatVariablesCollection;
}

/**
 * When the workbench has already attached implicit editor/selection (vscode.implicit.*), the
 * prompt includes that via {@link ChatVariablesAndQuery}; avoid duplicating full excerpts here.
 */
export function hasWorkbenchImplicitContext(chatVariables: ChatVariablesCollection): boolean {
	for (const v of chatVariables) {
		if (v.reference.id.startsWith('vscode.implicit')) {
			return true;
		}
	}
	return false;
}

function normalizeResourceUri(uri: URI, workspace: IWorkspaceService): URI {
	if (uri.scheme === Schemas.vscodeNotebookCell) {
		const [notebook] = getNotebookAndCellFromUri(uri, workspace.notebookDocuments);
		return notebook?.uri ?? uri;
	}
	return uri;
}

/**
 * Active document / notebook URI for comparing against @-attachments (Cursor-style: implicit
 * open file is skipped when the user explicitly references a different resource).
 */
export function getActiveContextUri(tabs: ITabsAndEditorsService, workspace: IWorkspaceService): URI | undefined {
	const textEditor = tabs.activeTextEditor;
	if (textEditor) {
		return normalizeResourceUri(textEditor.document.uri, workspace);
	}
	const notebookEditor = tabs.activeNotebookEditor;
	if (notebookEditor) {
		return notebookEditor.notebook.uri;
	}
	return tabs.activeCustomEditorUri;
}

/**
 * True when the user attached at least one file/folder/location that is not the active editor's resource.
 */
export function chatVariablesReferenceDifferentResource(
	chatVariables: ChatVariablesCollection,
	activeUri: URI | undefined,
	workspace: IWorkspaceService,
): boolean {
	if (!activeUri) {
		return false;
	}
	const activeNorm = normalizeResourceUri(activeUri, workspace);
	for (const v of chatVariables) {
		if (v.reference.id.startsWith('vscode.implicit')) {
			continue;
		}
		if (isInstructionFile(v) || isPromptFile(v) || isCustomizationsIndex(v) || isSessionReference(v)) {
			continue;
		}
		if (URI.isUri(v.value)) {
			const u = normalizeResourceUri(v.value, workspace);
			if (!isEqual(u, activeNorm)) {
				return true;
			}
		} else if (isLocation(v.value)) {
			const u = normalizeResourceUri(v.value.uri, workspace);
			if (!isEqual(u, activeNorm)) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Injects the active selection (if any) or visible/active file into panel chat when the workbench
 * did not already add implicit context, matching Cursor-style defaults: selection is always
 * included when present; the open file is included unless the user attached a different resource.
 */
export class PanelEditorSelectionContext extends PromptElement<PanelEditorSelectionContextProps, void> {
	constructor(
		props: PanelEditorSelectionContextProps,
		@ITabsAndEditorsService private readonly _tabsAndEditorsService: ITabsAndEditorsService,
		@IWorkspaceService private readonly _workspaceService: IWorkspaceService,
	) {
		super(props);
	}

	override render(_state: void, sizing: PromptSizing): PromptPiece<any, any> | undefined {
		const { chatVariables } = this.props;
		if (hasWorkbenchImplicitContext(chatVariables)) {
			return undefined;
		}

		const selection = CurrentSelection.getCurrentSelection(this._tabsAndEditorsService);
		if (selection) {
			return (
				<CurrentSelection
					document={TextDocumentSnapshot.create(selection.activeDocument)}
					priority={this.props.priority}
					flexGrow={this.props.flexGrow}
				/>
			);
		}

		const activeUri = getActiveContextUri(this._tabsAndEditorsService, this._workspaceService);
		if (chatVariablesReferenceDifferentResource(chatVariables, activeUri, this._workspaceService)) {
			return undefined;
		}

		return (
			<CurrentEditor priority={this.props.priority} flexGrow={this.props.flexGrow} />
		);
	}
}
