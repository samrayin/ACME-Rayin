import { useState, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  GripVertical,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { cn } from "@/src/utils/tailwind";
import { type CardSpan } from "@/src/features/acme-enhancements/utils/eyeonHomeLayout";

// ACME (CHG-2026-136, ADR-0028): arranging an EYEON page for oneself. In
// arrange mode each widget gets a bar with its name, its place, and real
// buttons to move it earlier or later and to hide it, so the keyboard and
// screen readers can do everything. Dragging by the grip is an extra for a
// mouse or a finger only, with @dnd-kit, already a console dependency: the
// grip is hidden from assistive technology and takes no focus, because the
// buttons do the same job. While arranging, a widget's own content is inert,
// so a click on a tile cannot open its page by mistake.

type ButtonRef = (element: HTMLButtonElement | null) => void;

const SPAN_CLASS: Record<CardSpan, string> = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
};

/**
 * One group of widgets that can be dragged among themselves. Holds the
 * pointer and touch sensors only; the frames' buttons are the keyboard path.
 */
export function EyeonArrangeZone({
  ids,
  nameOf,
  onDrop,
  children,
}: {
  ids: readonly string[];
  nameOf: (id: string) => string;
  /** A widget was dropped on another one: take that one's place. */
  onDrop: (id: string, target: string) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
  );
  const [dragging, setDragging] = useState<string | null>(null);
  const name = (id: UniqueIdentifier) => nameOf(String(id));
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${name(active.id)} is over ${name(over.id)}.`
        : `${name(active.id)} is not over a widget.`,
    // The page announces the new place itself once the move is saved.
    onDragEnd: () => undefined,
    onDragCancel: ({ active }) => `${name(active.id)} was not moved.`,
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "Drag by the grip with a mouse or a finger. With a keyboard, use the move buttons.",
        },
      }}
      onDragStart={({ active }) => setDragging(String(active.id))}
      onDragCancel={() => setDragging(null)}
      onDragEnd={({ active, over }) => {
        setDragging(null);
        if (over && active.id !== over.id)
          onDrop(String(active.id), String(over.id));
      }}
    >
      <SortableContext items={[...ids]} strategy={rectSortingStrategy}>
        {children}
      </SortableContext>
      <DragOverlay>
        {dragging ? (
          <span className="bg-background inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-bold shadow-md">
            <GripVertical className="h-4 w-4" aria-hidden="true" />
            {nameOf(dragging)}
          </span>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * A widget's place on an arrangeable page. Outside arrange mode it only lays
 * the widget out; in arrange mode it adds the widget's bar.
 */
export function EyeonArrangeFrame({
  id,
  name,
  place,
  count,
  arranging,
  span,
  onMoveEarlier,
  onMoveLater,
  onHide,
  buttonRef,
  children,
}: {
  id: string;
  /** The widget's fixed name, used by every control. */
  name: string;
  /** 1-based place among the widgets on screen, and how many there are. */
  place: number;
  count: number;
  arranging: boolean;
  /** Width in the three-column card grid of large screens. */
  span?: CardSpan;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  onHide: () => void;
  buttonRef: (action: "earlier" | "later" | "hide") => ButtonRef;
  children: ReactNode;
}) {
  const sortable = useSortable({ id, disabled: !arranging });
  return (
    <div
      ref={sortable.setNodeRef}
      role={arranging ? "group" : undefined}
      aria-label={arranging ? name : undefined}
      className={cn(
        "flex min-w-0 flex-col gap-1",
        span ? SPAN_CLASS[span] : undefined,
        arranging && "rounded-lg border border-dashed p-1",
        arranging &&
          sortable.isOver &&
          !sortable.isDragging &&
          "ring-ring ring-2",
        sortable.isDragging && "opacity-50",
      )}
    >
      {arranging ? (
        <div className="bg-muted flex flex-wrap items-center gap-1 rounded-md px-1 py-0.5">
          <span
            ref={sortable.setActivatorNodeRef}
            {...sortable.listeners}
            aria-hidden="true"
            title="Drag to move"
            className="text-muted-foreground cursor-grab touch-none"
          >
            <GripVertical className="h-4 w-4" />
          </span>
          <span
            className="min-w-0 flex-1 truncate text-xs font-bold"
            title={name}
          >
            {name}
          </span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {place} of {count}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            ref={buttonRef("earlier")}
            aria-label={`Move ${name} earlier`}
            title="Move earlier"
            disabled={place <= 1}
            onClick={onMoveEarlier}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            ref={buttonRef("later")}
            aria-label={`Move ${name} later`}
            title="Move later"
            disabled={place >= count}
            onClick={onMoveLater}
          >
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            ref={buttonRef("hide")}
            aria-label={`Hide ${name}`}
            title="Hide"
            onClick={onHide}
          >
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      <div className="grid min-h-0 flex-1" inert={arranging}>
        {children}
      </div>
    </div>
  );
}

/**
 * The bar shown while arranging: what arranging does, the hidden widgets to
 * show again, "Reset to default" and "Done".
 */
export function EyeonArrangeBar({
  hidden,
  onReset,
  resetDisabled,
  onDone,
  buttonRef,
  storageRefused,
}: {
  hidden: { key: string; name: string; onShow: () => void }[];
  onReset: () => void;
  /** True while the page already shows the default arrangement. */
  resetDisabled: boolean;
  onDone: () => void;
  /** "reset", "done", or "show:" and a hidden widget's key. */
  buttonRef: (key: string) => ButtonRef;
  /** The browser refused to keep the last change. */
  storageRefused: boolean;
}) {
  return (
    <section
      aria-label="Arrange this page"
      className="bg-muted/50 flex flex-col gap-3 rounded-lg border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          Move or hide tiles and cards. Your arrangement is kept in this
          browser, for you only: it changes nothing anyone else sees, and what
          each role may see stays the same.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            ref={buttonRef("reset")}
            disabled={resetDisabled}
            onClick={onReset}
          >
            <RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />
            Reset to default
          </Button>
          <Button type="button" ref={buttonRef("done")} onClick={onDone}>
            <Check className="mr-1 h-4 w-4" aria-hidden="true" />
            Done
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Hidden:</span>
        {hidden.length === 0 ? (
          <span className="text-muted-foreground">Nothing is hidden.</span>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="Hidden widgets">
            {hidden.map((h) => (
              <li key={h.key}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  ref={buttonRef(`show:${h.key}`)}
                  aria-label={`Show ${h.name}`}
                  onClick={h.onShow}
                >
                  <Eye className="mr-1 h-4 w-4" aria-hidden="true" />
                  {h.name}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {storageRefused ? (
        <p className="text-muted-foreground text-xs">
          This browser did not keep the arrangement, so it lasts only until you
          leave the page.
        </p>
      ) : null}
    </section>
  );
}
