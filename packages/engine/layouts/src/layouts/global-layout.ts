import {
  AbstractNode,
  LayoutOptions,
  LayoutType,
  MindLayoutType,
  OriginNode,
} from '../interfaces/mind';
import { abstractStandardSide } from '../utils/abstract';
import {
  isHorizontalLayout,
  isIndentedLayout,
  isLeftLayout,
  isStandardLayout,
  isTopLayout,
} from '../utils/layout';
import { BaseLayout } from './base-layout';

export class GlobalLayout {
  static layout(
    root: OriginNode,
    options: LayoutOptions,
    mindLayoutType: MindLayoutType,
  ) {
    const baseLayout = new BaseLayout();

    if (isStandardLayout(mindLayoutType)) {
      const primaryNodeCount = root.children.length;
      const rightBranchNodes = [];
      const leftBranchNodes = [];
      const fakeRootNode = { ...root };
      for (let i = 0; i < primaryNodeCount; i++) {
        const child = root.children[i];

        if (AbstractNode.isAbstract(child)) {
          // A summary may span the split; it still has to live on one side
          // so its layout indices stay inside that branch's children.
          (abstractStandardSide(child, root.rightNodeCount) === 'right'
            ? rightBranchNodes
            : leftBranchNodes
          ).push(child);
          continue;
        }

        if (i < root.rightNodeCount) {
          rightBranchNodes.push(child);
        } else {
          leftBranchNodes.push(child);
        }
      }
      // right
      fakeRootNode.children = rightBranchNodes;
      const rightRoot = baseLayout.layout(
        fakeRootNode,
        LayoutType.logic,
        options,
        { toLeft: false, toTop: false, rootLayoutType: mindLayoutType },
        true,
      );
      fakeRootNode.children = leftBranchNodes;
      const leftRoot = baseLayout.layout(
        fakeRootNode,
        LayoutType.logic,
        options,
        { toLeft: true, toTop: false, rootLayoutType: mindLayoutType },
        true,
      );
      leftRoot.right2left();
      rightRoot.translate(leftRoot.x - rightRoot.x, leftRoot.y - rightRoot.y);

      const rightAbstractArray = rightRoot.children.filter((child) =>
        AbstractNode.isAbstract(child.origin),
      );
      rightRoot.children = rightRoot.children.filter(
        (child) => !AbstractNode.isAbstract(child.origin),
      );

      leftRoot.children.forEach((leftPrimaryNode) => {
        rightRoot.children.push(leftPrimaryNode);
        leftPrimaryNode.parent = rightRoot;
      });
      rightRoot.children = rightRoot.children.concat(rightAbstractArray);

      rightRoot.x = leftRoot.x;
      rightRoot.origin = root;
      return rightRoot;
    }

    const isIndented = isIndentedLayout(mindLayoutType);
    const layoutType = isIndented ? LayoutType.indented : LayoutType.logic;
    const isHorizontal = isIndented ? true : isHorizontalLayout(mindLayoutType);
    const toTop = isTopLayout(mindLayoutType);
    const toLeft = isLeftLayout(mindLayoutType);
    const resultRoot = baseLayout.layout(
      root,
      layoutType,
      options,
      { toTop, toLeft, rootLayoutType: mindLayoutType },
      isHorizontal,
    );
    if (toTop) {
      resultRoot.down2up();
    }
    if (toLeft) {
      resultRoot.right2left();
    }
    return resultRoot;
  }
}
