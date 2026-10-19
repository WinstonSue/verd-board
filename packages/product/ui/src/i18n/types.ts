import { ReactNode } from 'react';

// Define supported languages
export type Language = 'zh' | 'en';

// Define translation keys and their corresponding values
export interface Translations {
  'settings.appearance': string;
  'settings.appearance.system': string;
  'settings.appearance.light': string;
  'settings.appearance.dark': string;
  'settings.appearance.description': string;
  'arrange.fitContent': string;
  'settings.mind': string;
  'settings.mindMaxWidth': string;
  'settings.mindMaxWidthDescription': string;
  'settings.resetMindWidth': string;
  'mind.maxNodeWidth': string;
  'mind.widthMode': string;
  'mind.followDefault': string;
  'mind.customWidth': string;
  'mind.effectiveWidth': string;
  'arrange.title': string;
  'arrange.left': string;
  'arrange.center': string;
  'arrange.right': string;
  'arrange.top': string;
  'arrange.middle': string;
  'arrange.bottom': string;
  'arrange.distributeHorizontal': string;
  'arrange.distributeVertical': string;
  'arrange.group': string;
  'arrange.ungroup': string;
  'arrange.lock': string;
  'arrange.unlock': string;
  'arrange.layout': string;
  'arrange.apply': string;
  'arrange.grid': string;
  'arrange.horizontal': string;
  'arrange.vertical': string;
  'arrange.flow': string;
  'arrange.layers': string;
  'arrange.cycle': string;
  'arrange.crossLayer': string;
  'arrange.currentScope': string;
  'settings.smartGuides': string;
  'settings.smartGuidesDescription': string;

  // Toolbar items
  'toolbar.hand': string;
  'toolbar.selection': string;
  'toolbar.mind': string;
  'toolbar.workflow': string;
  'toolbar.architecture': string;
  'toolbar.text': string;
  'toolbar.arrow': string;
  'toolbar.shape': string;
  'toolbar.image': string;

  'toolbar.pen': string;
  'toolbar.eraser': string;

  'toolbar.arrow.straight': string;
  'toolbar.arrow.elbow': string;
  'toolbar.arrow.curve': string;

  'toolbar.shape.rectangle': string;
  'toolbar.shape.ellipse': string;
  'toolbar.shape.triangle': string;
  'toolbar.shape.terminal': string;
  'toolbar.shape.diamond': string;
  'toolbar.shape.parallelogram': string;
  'toolbar.shape.roundRectangle': string;

  // Shape names
  'shape.name.rectangle': string;
  'shape.name.roundRectangle': string;
  'shape.name.ellipse': string;
  'shape.name.diamond': string;
  'shape.name.triangle': string;
  'shape.name.parallelogram': string;
  'shape.name.trapezoid': string;
  'shape.name.leftArrow': string;
  'shape.name.rightArrow': string;
  'shape.name.cross': string;
  'shape.name.star': string;
  'shape.name.pentagon': string;
  'shape.name.hexagon': string;
  'shape.name.octagon': string;
  'shape.name.pentagonArrow': string;
  'shape.name.processArrow': string;
  'shape.name.twoWayArrow': string;
  'shape.name.comment': string;
  'shape.name.roundComment': string;
  'shape.name.cloud': string;
  'shape.name.process': string;
  'shape.name.decision': string;
  'shape.name.data': string;
  'shape.name.connector': string;
  'shape.name.terminal': string;
  'shape.name.manualInput': string;
  'shape.name.preparation': string;
  'shape.name.manualLoop': string;
  'shape.name.merge': string;
  'shape.name.delay': string;
  'shape.name.storedData': string;
  'shape.name.or': string;
  'shape.name.summingJunction': string;
  'shape.name.predefinedProcess': string;
  'shape.name.offPage': string;
  'shape.name.document': string;
  'shape.name.multiDocument': string;
  'shape.name.database': string;
  'shape.name.hardDisk': string;
  'shape.name.internalStorage': string;
  'shape.name.noteCurlyRight': string;
  'shape.name.noteCurlyLeft': string;
  'shape.name.noteSquare': string;
  'shape.name.display': string;
  'shape.name.actor': string;
  'shape.name.useCase': string;
  'shape.name.container': string;
  'shape.name.note': string;
  'shape.name.simpleClass': string;
  'shape.name.activityClass': string;
  'shape.name.branchMerge': string;
  'shape.name.port': string;
  'shape.name.package': string;
  'shape.name.combinedFragment': string;
  'shape.name.class': string;
  'shape.name.interface': string;
  'shape.name.object': string;
  'shape.name.component': string;
  'shape.name.componentBox': string;
  'shape.name.template': string;
  'shape.name.activation': string;
  'shape.name.deletion': string;
  'shape.name.assembly': string;
  'shape.name.providedInterface': string;
  'shape.name.requiredInterface': string;

  // Zoom controls
  'zoom.in': string;
  'zoom.out': string;
  'zoom.fit': string;
  'zoom.100': string;

  // Themes
  'theme.default': string;
  'theme.colorful': string;
  'theme.soft': string;
  'theme.retro': string;
  'theme.dark': string;
  'theme.starry': string;

  // Colors
  'color.none': string;
  'color.unknown': string;
  'color.default': string;
  'color.white': string;
  'color.gray': string;
  'color.deepBlue': string;
  'color.red': string;
  'color.green': string;
  'color.yellow': string;
  'color.purple': string;
  'color.orange': string;
  'color.pastelPink': string;
  'color.cyan': string;
  'color.brown': string;
  'color.forestGreen': string;
  'color.lightGray': string;

  // General
  'general.undo': string;
  'general.redo': string;
  'general.menu': string;
  'general.duplicate': string;
  'general.delete': string;
  'general.more': string;
  'general.cut': string;
  'general.copy': string;
  'layer.order': string;
  'layer.moveUp': string;
  'layer.moveDown': string;
  'layer.toTop': string;
  'layer.toBottom': string;

  'settings.title': string;
  'settings.back': string;
  'settings.general': string;
  'settings.interaction': string;
  'settings.interactionDescription': string;
  'settings.zoomSensitivity': string;
  'settings.zoomSensitivityDescription': string;
  'settings.dragPanSpeed': string;
  'settings.dragPanSpeedDescription': string;
  'settings.resetInteraction': string;
  'menu.importText': string;
  'menu.exportImage': string;
  'menu.exportMermaid': string;
  'menu.clear': string;

  // Language
  'language.switcher': string;
  'language.chinese': string;
  'language.english': string;

  // Menu items
  'menu.open': string;
  'menu.openError': string;
  'menu.saveFile': string;
  'menu.import': string;
  'menu.export': string;
  'menu.importMermaid': string;
  'menu.importMarkdown': string;
  'menu.exportMarkdown': string;
  'menu.exportImage.svg': string;
  'menu.exportImage.png': string;
  'menu.exportImage.jpg': string;
  'menu.cleanBoard': string;

  // Dialog translations
  'dialog.mermaid.title': string;
  'dialog.mermaid.description': string;
  'dialog.mermaid.flowchart': string;
  'dialog.mermaid.sequence': string;
  'dialog.mermaid.class': string;
  'dialog.mermaid.otherTypes': string;
  'dialog.mermaid.syntax': string;
  'dialog.mermaid.placeholder': string;
  'dialog.mermaid.preview': string;
  'dialog.mermaid.insert': string;
  'dialog.markdown.description': string;
  'dialog.markdown.syntax': string;
  'dialog.markdown.placeholder': string;
  'dialog.markdown.preview': string;
  'dialog.markdown.insert': string;
  'dialog.verdBoardToMarkdown.description': string;
  'dialog.verdBoardToMarkdown.result': string;
  'dialog.verdBoardToMarkdown.copy': string;
  'dialog.verdBoardToMarkdown.placeholder': string;
  'dialog.error.loadMermaid': string;

  // Clean confirm dialog
  'cleanConfirm.title': string;
  'cleanConfirm.description': string;
  'cleanConfirm.cancel': string;
  'cleanConfirm.ok': string;

  // Link popup items
  'popupLink.delLink': string;

  // Tool popup items
  'popupToolbar.fillColor': string;
  'popupToolbar.fontColor': string;
  'popupToolbar.link': string;
  'popupToolbar.stroke': string;
  'popupToolbar.opacity': string;
  'popupToolbar.borderWidth': string;
  'popupToolbar.noColor': string;
  'popupToolbar.moreColors': string;
  'popupToolbar.shadow': string;
  'popupToolbar.aspectRatio': string;
  'frame.position.x': string;
  'frame.position.y': string;
  'frame.size.width': string;
  'frame.size.height': string;
  'frame.aspect.lock': string;
  'frame.aspect.custom': string;
  'frame.aspect.a4': string;
  'frame.aspect.square': string;
  'frame.aspect.4x3': string;
  'frame.aspect.16x10': string;
  'frame.aspect.16x9': string;
  'frame.aspect.browser': string;
  'frame.aspect.tablet': string;
  'frame.aspect.phone': string;
  'shadow.none': string;
  'shadow.sm': string;
  'shadow.md': string;
  'shadow.lg': string;
  'canvasStatus.theme': string;
  'canvasStatus.settings': string;
  'canvasStatus.overview': string;
  'canvasStatus.fit': string;
  'canvasStatus.recenter': string;
  'canvasStatus.zoomIn': string;
  'canvasStatus.zoomOut': string;
  'canvasStatus.autoLayout': string;

  // Text placeholders
  'textPlaceholders.link': string;
  'textPlaceholders.text': string;

  // Line tool
  'line.source': string;
  'line.target': string;
  'line.arrow': string;
  'line.none': string;

  // Stroke style
  'stroke.solid': string;
  'stroke.dashed': string;
  'stroke.dotted': string;

  //markdown example
  'markdown.example': string;

  // Draw elements text
  'draw.lineText': string;
  'draw.geometryText': string;

  // Mind map elements text
  'mind.centralText': string;
  'mind.abstractNodeText': string;

  'save.saving': string;
  'save.saved': string;
  'save.error': string;
  'save.retry': string;
  'save.unsaved': string;
  'save.unknownTime': string;
  'save.lastSaved': string;

  'rightPanel.canvasSettings': string;
  'rightPanel.mindConfig': string;
  'rightPanel.elementProps': string;
  'rightPanel.selectedCount': string;
  'rightPanel.canvasGlobal': string;
  'rightPanel.defaultTitleColor': string;
  'rightPanel.defaultStroke': string;
  'rightPanel.defaultFill': string;
  'rightPanel.titleColor': string;
  'rightPanel.stroke': string;
  'rightPanel.fill': string;
  'rightPanel.link': string;
  'rightPanel.arrow': string;
  'rightPanel.arrowStart': string;
  'rightPanel.arrowEnd': string;
  'rightPanel.note': string;
  'rightPanel.canvasTheme': string;
  'rightPanel.colorScheme': string;
  'rightPanel.background': string;
  'rightPanel.showGrid': string;
  'rightPanel.gridSize': string;
  'rightPanel.canvasInfo': string;
  'rightPanel.zoom': string;
  'rightPanel.canvasSize': string;
  'rightPanel.layout': string;
  'rightPanel.bg.white': string;
  'rightPanel.bg.lightGray': string;
  'rightPanel.bg.gray': string;
  'rightPanel.bg.soft': string;
  'rightPanel.bg.retro': string;
  'rightPanel.bg.dark': string;
  'rightPanel.bg.starry': string;
  'rightPanel.bg.deepGray': string;

  'mind.layout.standard': string;
  'mind.layout.right': string;
  'mind.layout.left': string;
  'mind.layout.downward': string;

  'note.add': string;
  'note.edit': string;
  'note.expand': string;
  'note.collapse': string;
  'note.delete': string;

  'popupToolbar.addNote': string;
  'popupToolbar.editNote': string;
  'popupToolbar.expandNote': string;
  'popupToolbar.collapseNote': string;

  'app.name': string;

  'tutorial.title': string;
  'tutorial.description': string;
  'tutorial.dataDescription': string;
  'tutorial.markdown': string;
  'tutorial.skip': string;
  'tutorial.appToolbar': string;
  'tutorial.creationToolbar': string;
  'tutorial.themeDescription': string;

  'workspace.board': string;
  'workspace.mind': string;
  'workspace.workflow': string;
  'workspace.architecture': string;
  'workspace.back': string;
  'mind.addChild': string;
  'mind.openExclusive': string;
  'component.openDetail': string;
  'workflow.palette.task': string;
  'workflow.palette.decision': string;
  'workflow.inspector.label': string;
  'architecture.kind.label': string;
  'architecture.kind.box': string;
  'architecture.kind.decision': string;
  'architecture.kind.store': string;
  'architecture.action.delete': string;
  'architecture.edge.label': string;
  'workflow.inspector.empty': string;
  'workflow.start': string;
  'workflow.empty': string;
  'workflow.addGraph': string;
  'workflow.mode.label': string;
  'workflow.mode.dag': string;
  'workflow.mode.process': string;
  'workflow.layout.cyclic': string;
  'presentation.open': string;
  'presentation.overview': string;
  'presentation.previous': string;
  'presentation.next': string;
  'presentation.laser': string;
  'presentation.exit': string;
  'presentation.hint': string;
  'presentation.hintSteps': string;
}

// I18n context interface
export interface I18nContextType {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: keyof Translations) => string;
}

// Provider props
export interface I18nProviderProps {
  children: ReactNode;
  defaultLanguage?: Language;
  language?: Language;
  persistLanguage?: boolean;
  messages?: Partial<Record<Language, Partial<Translations>>>;
  onLanguageChange?: (language: Language) => void;
}
