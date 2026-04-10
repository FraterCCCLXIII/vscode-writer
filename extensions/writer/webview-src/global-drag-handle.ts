/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Fork of tiptap-extension-global-drag-handle with `p` instead of `p:not(:first-child)`
 * so every paragraph (e.g. first inside blockquote) gets a grip at the block top.
 */
import { Extension } from '@tiptap/core';
import {
	NodeSelection,
	Plugin,
	PluginKey,
	TextSelection,
} from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import * as pmView from '@tiptap/pm/view';
import { getScrollableAncestor } from './scroll-parent';

function getPmView() {
	try {
		return pmView;
	} catch {
		return null;
	}
}

function serializeForClipboard(
	view: EditorView,
	slice: Slice,
): { dom: HTMLElement; text: string } {
	const v = view as EditorView & {
		serializeForClipboard?: (slice: Slice) => {
			dom: HTMLElement;
			text: string;
		};
	};
	if (view && typeof v.serializeForClipboard === 'function') {
		return v.serializeForClipboard(slice);
	}
	const proseMirrorView = getPmView() as unknown as {
		__serializeForClipboard?: (view: EditorView, slice: Slice) => {
			dom: HTMLElement;
			text: string;
		};
	};
	if (
		proseMirrorView &&
		typeof proseMirrorView.__serializeForClipboard === 'function'
	) {
		return proseMirrorView.__serializeForClipboard(view, slice);
	}
	throw new Error('No supported clipboard serialization method found.');
}

function absoluteRect(node: Element) {
	const data = node.getBoundingClientRect();
	const modal = node.closest('[role="dialog"]');
	if (modal && window.getComputedStyle(modal).transform !== 'none') {
		const modalRect = modal.getBoundingClientRect();
		return {
			top: data.top - modalRect.top,
			left: data.left - modalRect.left,
			width: data.width,
		};
	}
	return {
		top: data.top,
		left: data.left,
		width: data.width,
	};
}

function nodeDOMAtCoords(
	coords: { x: number; y: number },
	options: { customNodes: string[] },
) {
	const selectors = [
		'li',
		'p',
		'pre',
		'blockquote',
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',
		...options.customNodes.map((node) => `[data-type=${node}]`),
	].join(', ');
	return document
		.elementsFromPoint(coords.x, coords.y)
		.find(
			(elem) =>
				elem.parentElement?.matches?.('.ProseMirror') ||
				elem.matches(selectors),
		);
}

function nodePosAtDOM(
	node: Element,
	view: EditorView,
	options: { dragHandleWidth: number },
) {
	const boundingRect = node.getBoundingClientRect();
	return view.posAtCoords({
		left: boundingRect.left + 50 + options.dragHandleWidth,
		top: boundingRect.top + 1,
	})?.inside;
}

function calcNodePos(pos: number, view: EditorView) {
	const $pos = view.state.doc.resolve(pos);
	if ($pos.depth > 1) {
		return $pos.before($pos.depth);
	}
	return pos;
}

export interface GlobalDragHandleOptions {
	dragHandleWidth: number;
	scrollTreshold: number;
	dragHandleSelector?: string;
	excludedTags: string[];
	customNodes: string[];
}

export function DragHandlePlugin(
	options: GlobalDragHandleOptions & { pluginKey: string },
) {
	let listType = '';
	function handleDragStart(event: DragEvent, view: EditorView) {
		view.focus();
		if (!event.dataTransfer) {
			return;
		}
		const node = nodeDOMAtCoords(
			{
				x: event.clientX + 50 + options.dragHandleWidth,
				y: event.clientY,
			},
			options,
		);
		if (!(node instanceof Element)) {
			return;
		}
		let draggedNodePos = nodePosAtDOM(node, view, options);
		if (draggedNodePos === null || draggedNodePos === undefined || draggedNodePos < 0) {
			return;
		}
		draggedNodePos = calcNodePos(draggedNodePos, view);
		const { from, to } = view.state.selection;
		const diff = from - to;
		const fromSelectionPos = calcNodePos(from, view);
		let differentNodeSelected = false;
		const nodePos = view.state.doc.resolve(fromSelectionPos);
		if (nodePos.node().type.name === 'doc') {
			differentNodeSelected = true;
		} else {
			const nodeSelection = NodeSelection.create(
				view.state.doc,
				nodePos.before(),
			);
			differentNodeSelected = !(
				draggedNodePos + 1 >= nodeSelection.$from.pos &&
				draggedNodePos <= nodeSelection.$to.pos
			);
		}
		let selection = view.state.selection;
		if (
			!differentNodeSelected &&
			diff !== 0 &&
			!(view.state.selection instanceof NodeSelection)
		) {
			const endSelection = NodeSelection.create(view.state.doc, to - 1);
			selection = TextSelection.create(
				view.state.doc,
				draggedNodePos,
				endSelection.$to.pos,
			);
		} else {
			let nodeSel = NodeSelection.create(view.state.doc, draggedNodePos);
			if (
				nodeSel.node.type.isInline ||
				nodeSel.node.type.name === 'tableRow'
			) {
				const $pos = view.state.doc.resolve(nodeSel.from);
				nodeSel = NodeSelection.create(view.state.doc, $pos.before());
			}
			selection = nodeSel;
		}
		view.dispatch(view.state.tr.setSelection(selection));
		if (
			view.state.selection instanceof NodeSelection &&
			view.state.selection.node.type.name === 'listItem'
		) {
			listType = node.parentElement?.tagName ?? '';
		}
		const slice = view.state.selection.content();
		const { dom, text } = serializeForClipboard(view, slice);
		event.dataTransfer.clearData();
		event.dataTransfer.setData('text/html', dom.innerHTML);
		event.dataTransfer.setData('text/plain', text);
		event.dataTransfer.effectAllowed = 'copyMove';
		event.dataTransfer.setDragImage(node, 0, 0);
		view.dragging = { slice, move: event.ctrlKey };
	}

	let dragHandleElement: HTMLDivElement | null = null;
	function hideDragHandle() {
		if (dragHandleElement) {
			dragHandleElement.classList.add('hide');
		}
	}
	function showDragHandle() {
		if (dragHandleElement) {
			dragHandleElement.classList.remove('hide');
		}
	}
	function hideHandleOnEditorOut(event: MouseEvent) {
		if (event.target instanceof Element) {
			const relatedTarget = event.relatedTarget;
			const isInsideEditor =
				relatedTarget instanceof Element &&
				(relatedTarget.classList.contains('tiptap') ||
					relatedTarget.classList.contains('drag-handle'));
			if (isInsideEditor) {
				return;
			}
		}
		hideDragHandle();
	}
	return new Plugin({
		key: new PluginKey(options.pluginKey),
		view: (view) => {
			const handleBySelector = options.dragHandleSelector
				? document.querySelector(options.dragHandleSelector)
				: null;
			dragHandleElement = (handleBySelector ??
				document.createElement('div')) as HTMLDivElement;
			dragHandleElement.draggable = true;
			dragHandleElement.dataset.dragHandle = '';
			dragHandleElement.classList.add('drag-handle');
			function onDragHandleDragStart(e: DragEvent) {
				handleDragStart(e, view);
			}
			dragHandleElement.addEventListener('dragstart', onDragHandleDragStart);
			function onDragHandleDrag(e: DragEvent) {
				hideDragHandle();
				const root = getScrollableAncestor(view.dom);
				if (root) {
					const top = root.scrollTop;
					if (e.clientY < options.scrollTreshold) {
						root.scrollTo({ top: top - 30, behavior: 'smooth' });
					} else if (window.innerHeight - e.clientY < options.scrollTreshold) {
						root.scrollTo({ top: top + 30, behavior: 'smooth' });
					}
				} else {
					const scrollY = window.scrollY;
					if (e.clientY < options.scrollTreshold) {
						window.scrollTo({ top: scrollY - 30, behavior: 'smooth' });
					} else if (window.innerHeight - e.clientY < options.scrollTreshold) {
						window.scrollTo({ top: scrollY + 30, behavior: 'smooth' });
					}
				}
			}
			dragHandleElement.addEventListener('drag', onDragHandleDrag);
			hideDragHandle();
			if (!handleBySelector) {
				view?.dom?.parentElement?.appendChild(dragHandleElement);
			}
			view?.dom?.parentElement?.addEventListener('mouseout', hideHandleOnEditorOut);
			return {
				destroy: () => {
					if (!handleBySelector) {
						dragHandleElement?.remove?.();
					}
					dragHandleElement?.removeEventListener('drag', onDragHandleDrag);
					dragHandleElement?.removeEventListener(
						'dragstart',
						onDragHandleDragStart,
					);
					dragHandleElement = null;
					view?.dom?.parentElement?.removeEventListener(
						'mouseout',
						hideHandleOnEditorOut,
					);
				},
			};
		},
		props: {
			handleDOMEvents: {
				mousemove: (view, event) => {
					if (!view.editable) {
						return;
					}
					const node = nodeDOMAtCoords(
						{
							x: event.clientX + 50 + options.dragHandleWidth,
							y: event.clientY,
						},
						options,
					);
					const notDragging = node?.closest('.not-draggable');
					const excludedTagList = options.excludedTags
						.concat(['ol', 'ul'])
						.join(', ');
					if (
						!(node instanceof Element) ||
						node.matches(excludedTagList) ||
						notDragging
					) {
						hideDragHandle();
						return;
					}
					const compStyle = window.getComputedStyle(node);
					const parsedLineHeight = parseInt(compStyle.lineHeight, 10);
					const parsedFontSize = parseInt(compStyle.fontSize, 10);
					const lineHeight = Number.isNaN(parsedLineHeight)
						? (Number.isNaN(parsedFontSize) ? 16 : parsedFontSize) * 1.2
						: parsedLineHeight;
					const paddingTop = parseInt(compStyle.paddingTop, 10) || 0;
					const rect = absoluteRect(node);
					rect.top += (lineHeight - 24) / 2;
					rect.top += paddingTop;
					if (node.matches('ul:not([data-type=taskList]) li, ol li')) {
						rect.left -= options.dragHandleWidth;
					}
					rect.width = options.dragHandleWidth;
					if (!dragHandleElement) {
						return;
					}
					dragHandleElement.style.left = `${rect.left - rect.width}px`;
					dragHandleElement.style.top = `${rect.top}px`;
					showDragHandle();
				},
				keydown: () => {
					hideDragHandle();
				},
				mousewheel: () => {
					hideDragHandle();
				},
				dragstart: (view) => {
					view.dom.classList.add('dragging');
				},
				drop: (view, event) => {
					view.dom.classList.remove('dragging');
					hideDragHandle();
					let droppedNode = null;
					const dropPos = view.posAtCoords({
						left: event.clientX,
						top: event.clientY,
					});
					if (!dropPos) {
						return;
					}
					if (view.state.selection instanceof NodeSelection) {
						droppedNode = view.state.selection.node;
					}
					if (!droppedNode) {
						return;
					}
					const resolvedPos = view.state.doc.resolve(dropPos.pos);
					const isDroppedInsideList =
						resolvedPos.parent.type.name === 'listItem';
					if (
						view.state.selection instanceof NodeSelection &&
						view.state.selection.node.type.name === 'listItem' &&
						!isDroppedInsideList &&
						listType === 'OL'
					) {
						const newList = view.state.schema.nodes.orderedList?.createAndFill(
							null,
							droppedNode,
						);
						if (newList) {
							const slice = new Slice(Fragment.from(newList), 0, 0);
							view.dragging = { slice, move: event.ctrlKey };
						}
					}
				},
				dragend: (view) => {
					view.dom.classList.remove('dragging');
				},
			},
		},
	});
}

const GlobalDragHandle = Extension.create<
	GlobalDragHandleOptions,
	Record<string, never>
>({
	name: 'globalDragHandle',
	addOptions() {
		return {
			dragHandleWidth: 20,
			scrollTreshold: 100,
			excludedTags: [] as string[],
			customNodes: [] as string[],
		};
	},
	addProseMirrorPlugins() {
		return [
			DragHandlePlugin({
				pluginKey: 'globalDragHandle',
				dragHandleWidth: this.options.dragHandleWidth,
				scrollTreshold: this.options.scrollTreshold,
				dragHandleSelector: this.options.dragHandleSelector,
				excludedTags: this.options.excludedTags,
				customNodes: this.options.customNodes,
			}),
		];
	},
});

export default GlobalDragHandle;
