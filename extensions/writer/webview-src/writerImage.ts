/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Image from '@tiptap/extension-image';

/**
 * Image node with `data-md-src` for stable Markdown paths; `src` is the webview resource URL for display.
 */
export const WriterImage = Image.extend({
	name: 'image',

	addAttributes() {
		return {
			...this.parent?.(),
			dataMdSrc: {
				default: null,
				parseHTML: el => el.getAttribute('data-md-src'),
				renderHTML: attrs => {
					if (!attrs.dataMdSrc) {
						return {};
					}
					return { 'data-md-src': attrs.dataMdSrc };
				},
			},
		};
	},
});
