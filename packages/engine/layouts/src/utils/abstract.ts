import { LayoutNode } from '../interfaces/layout-node';
import { LayoutTreeNode } from '../interfaces/layout-tree-node';
import { AbstractNode } from '../interfaces/mind';
import { isStandardLayout } from './layout';

export const getNonAbstractChildren = <
  T extends { children?: T[] } = LayoutNode | LayoutTreeNode,
>(
  parentNode: T,
) => {
  if (parentNode.children) {
    return parentNode.children?.filter((child) => {
      if (child instanceof LayoutNode) {
        return !AbstractNode.isAbstract(child.origin);
      }
      if (child instanceof LayoutTreeNode) {
        return !AbstractNode.isAbstract(child.origin.origin);
      }
      return !AbstractNode.isAbstract(child);
    });
  } else {
    return [];
  }
};

export const findAbstractByEndNode = <
  T extends { children: T[] } = LayoutNode | LayoutTreeNode,
>(
  parentNode: T,
  endNode: T,
) => {
  const index = parentNode.children.indexOf(endNode);
  return parentNode.children.find((child) => {
    if (child instanceof LayoutNode) {
      return (
        AbstractNode.isAbstract(child.origin) && child.origin.end === index
      );
    }
    if (
      child instanceof LayoutTreeNode &&
      parentNode instanceof LayoutTreeNode
    ) {
      if (AbstractNode.isAbstract(child.origin.origin)) {
        const { end } = getCorrectStartEnd(
          child.origin.origin,
          parentNode.origin,
        );
        return end === index;
      }
      return false;
    }
    return AbstractNode.isAbstract(child) && child.end === index;
  });
};

export const findAbstractByStartNode = <
  T extends { children: T[] } = LayoutNode | LayoutTreeNode,
>(
  parentNode: T,
  startNode: T,
) => {
  const index = parentNode.children.indexOf(startNode);
  return parentNode.children.find((child) => {
    if (child instanceof LayoutNode) {
      return (
        AbstractNode.isAbstract(child.origin) && child.origin.start === index
      );
    }
    if (
      child instanceof LayoutTreeNode &&
      parentNode instanceof LayoutTreeNode
    ) {
      if (AbstractNode.isAbstract(child.origin.origin)) {
        const { start } = getCorrectStartEnd(
          child.origin.origin,
          parentNode.origin,
        );
        return start === index;
      }
      return false;
    }
    return AbstractNode.isAbstract(child) && child.start === index;
  });
};

/**
 * Side assignment for a summary under a standard root split. Abstracts that
 * sit entirely on one side follow it; a range spanning the split cannot be
 * represented on both branches, so it attaches to the side holding the most
 * covered siblings (the right branch wins ties because it holds the first
 * covered sibling).
 */
export const abstractStandardSide = (
  abstract: AbstractNode,
  rightNodeCount: number,
): 'right' | 'left' => {
  if (abstract.end < rightNodeCount) return 'right';
  if (abstract.start >= rightNodeCount) return 'left';
  const rightCovered = rightNodeCount - abstract.start;
  const leftCovered = abstract.end - rightNodeCount + 1;
  return leftCovered > rightCovered ? 'left' : 'right';
};

/**
 * handle standard layout effect
 * the abstract correct start and end should sub rightNodeCount when it is set on left area
 */
export const getCorrectStartEnd = (
  abstract: AbstractNode,
  parent: LayoutNode,
) => {
  let start = abstract.start;
  let end = abstract.end;
  if (isStandardLayout(parent.layout)) {
    const rightNodeCount = parent.origin.rightNodeCount;
    if (start >= rightNodeCount) {
      end -= rightNodeCount;
      start -= rightNodeCount;
    } else if (end >= rightNodeCount) {
      // The summary spans both sides of the split; clamp the covered range
      // to the indices of the branch it was assigned to.
      if (abstractStandardSide(abstract, rightNodeCount) === 'right')
        end = rightNodeCount - 1;
      else {
        end -= rightNodeCount;
        start = 0;
      }
    }
  }
  return { start, end };
};
