import { useId, useState, type HTMLAttributes, type Ref } from 'react';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
} from '@floating-ui/react';
import { Waypoints } from 'lucide-react';
import { createDefaultShapeGeometryRegistry } from '@sue/board-core';
import { useI18n, type Translations } from './i18n';

const shapes = createDefaultShapeGeometryRegistry();

/** Visual shape choices with localized names on hover and keyboard focus. */
export function FrameShapePicker({
  shapes,
  value,
  onChange,
  pathLabel,
  onSelectPath,
  floatingRef,
  containerProps,
}: {
  shapes: readonly string[];
  value: string;
  onChange(shape: string): void;
  pathLabel?: string;
  onSelectPath?(): void;
  floatingRef?: Ref<HTMLDivElement>;
  containerProps?: HTMLAttributes<HTMLDivElement>;
}) {
  const { t } = useI18n();
  return (
    <div className="frame-shape-picker" ref={floatingRef} {...containerProps}>
      <div className="frame-shape-grid">
        {shapes.map((shape) => (
          <ShapeButton
            key={shape}
            shape={shape}
            label={t(`shape.name.${shape}` as keyof Translations)}
            pressed={shape === value}
            onClick={() => onChange(shape)}
          />
        ))}
      </div>
      {onSelectPath && (
        <button
          type="button"
          className="frame-shape-path"
          onClick={onSelectPath}
        >
          <Waypoints size={16} aria-hidden />
          {pathLabel}
        </button>
      )}
    </div>
  );
}

function ShapeButton({
  shape,
  label,
  pressed,
  onClick,
}: {
  shape: string;
  label: string;
  pressed: boolean;
  onClick(): void;
}) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, {
    delay: { open: 400, close: 0 },
    move: false,
  });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
  ]);
  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        className="frame-shape-preview"
        aria-label={label}
        aria-pressed={pressed}
        aria-describedby={open ? tooltipId : undefined}
        data-testid={`shape-${shape}`}
        data-shape={shape}
        {...getReferenceProps({ onClick })}
      >
        <ShapeGlyph name={shape} />
      </button>
      {open && (
        <FloatingPortal>
          <div
            id={tooltipId}
            role="tooltip"
            className="frame-icon-tooltip"
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
          >
            {label}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

function ShapeGlyph({ name }: { name: string }) {
  const geometry = shapes.get(name);
  const bounds = { x: 1, y: 1, width: 16, height: 16 };
  const parts = geometry?.parts?.(bounds) ?? [
    { d: geometry?.path(bounds) ?? '' },
  ];
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      {parts.map((part, index) => (
        <path
          key={index}
          d={part.d}
          fill={part.fill ?? 'none'}
          strokeDasharray={part.strokeDasharray}
        />
      ))}
    </svg>
  );
}
