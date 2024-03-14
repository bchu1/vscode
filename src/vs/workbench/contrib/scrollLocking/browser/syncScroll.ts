/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { localize, localize2 } from 'vs/nls';
import { Categories } from 'vs/platform/action/common/actionCommonCategories';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IEditorPane, IEditorPaneScrollPosition } from 'vs/workbench/common/editor';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IStatusbarService, StatusbarAlignment } from 'vs/workbench/services/statusbar/browser/statusbar';

export class SyncScroll extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.syncScrolling';

	private readonly editorsInitialScrollTop = new Map<IEditorPane, IEditorPaneScrollPosition | undefined>();

	private readonly syncScrollDispoasbles = this._register(new DisposableStore());
	private readonly paneDisposables = new DisposableStore();

	private statusBarDisposable: IDisposable | undefined;

	private isActive: boolean = false;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IStatusbarService private readonly statusbarService: IStatusbarService
	) {
		super();

		this.registerActions();
	}

	private registerActiveListeners(): void {
		this.syncScrollDispoasbles.add(this.editorService.onDidVisibleEditorsChange(() => this.trackVisibleTextEditors()));
	}

	private activate(): void {
		this.registerActiveListeners();

		this.trackVisibleTextEditors();
	}

	toggle(): void {
		if (this.isActive) {
			this.deactivate();
		} else {
			this.activate();
		}

		this.isActive = !this.isActive;

		this.toggleStatusbarItem(this.isActive);
	}

	private trackVisibleTextEditors(): void {
		this.paneDisposables.clear();
		this.editorsInitialScrollTop.clear();

		for (const pane of this.editorService.visibleEditorPanes) {

			if (!pane.getScrollPosition || !pane.onDidChangeScroll) {
				continue;
			}

			this.editorsInitialScrollTop.set(pane, pane.getScrollPosition());
			this.paneDisposables.add(pane.onDidChangeScroll(() => this.onDidEditorPaneScroll(pane)));
		}
	}

	private onDidEditorPaneScroll(scrolledPane: IEditorPane) {

		const scrolledPaneInitialOffset = this.editorsInitialScrollTop.get(scrolledPane)?.scrollTop;
		if (scrolledPaneInitialOffset === undefined) {
			throw new Error('Scrolled pane not tracked');
		}

		const scrolledPaneScrollTop = scrolledPane.getScrollPosition!().scrollTop;
		const scrolledFromInitial = scrolledPaneScrollTop - scrolledPaneInitialOffset;

		for (const pane of this.editorService.visibleEditorPanes) {
			if (pane === scrolledPane) {
				continue;
			}

			if (!pane.setScrollPosition) {
				return;
			}

			const initialOffset = this.editorsInitialScrollTop.get(pane);
			if (initialOffset === undefined) {
				throw new Error('Could not find initial offset for pane');
			}

			pane.setScrollPosition({
				scrollTop: initialOffset.scrollTop + scrolledFromInitial,
			});
		}
	}

	private deactivate(): void {
		this.paneDisposables.clear();
		this.syncScrollDispoasbles.clear();
		this.editorsInitialScrollTop.clear();
	}

	private toggleStatusbarItem(active: boolean): void {
		if (active) {
			this.statusBarDisposable = this.statusbarService.addEntry({
				name: 'Scrolling Locked',
				text: 'Scrolling Locked',
				tooltip: 'Lock Scrolling enabled',
				ariaLabel: 'Scrolling Locked',
				command: {
					id: 'workbench.action.toggleLockedScrolling',
					title: ''
				},
				kind: 'prominent'
			}, 'status.snyScrollEnabled', StatusbarAlignment.RIGHT, 102);
		} else {
			this.statusBarDisposable?.dispose();
		}
	}

	private registerActions() {
		const $this = this;
		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.toggleLockedScrolling',
					title: {
						...localize2('toggleLockedScrolling', "Toggle Locked Scrolling Across Editors"),
						mnemonicTitle: localize({ key: 'miToggleLockedScrolling', comment: ['&& denotes a mnemonic'] }, "Locked Scrolling"),
					},
					category: Categories.View,
					f1: true
				});
			}

			run(): void {
				$this.toggle();
			}
		}));
		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.holdLockedScrolling',
					title: {
						...localize2('holdLockedScrolling', "Hold Locked Scrolling Across Editors"),
						mnemonicTitle: localize({ key: 'miHoldLockedScrolling', comment: ['&& denotes a mnemonic'] }, "Locked Scrolling"),
					},
					category: Categories.View,
				});
			}

			run(accessor: ServicesAccessor): void {
				const keybindingService = accessor.get(IKeybindingService);

				// Enable Sync Scrolling while pressed
				$this.toggle();

				const holdMode = keybindingService.enableKeybindingHoldMode('workbench.action.holdLockedScrolling');
				if (!holdMode) {
					return;
				}

				holdMode.finally(() => {
					$this.toggle();
				});
			}
		}));
	}

	override dispose(): void {
		this.deactivate();
		super.dispose();
	}
}
