// Refract: types as documentation. Two ways in, one set of markup:
//   1. HTML + CSS classes (`rf-*`) + `Refract.init()`: works in any stack.
//   2. React 18 components on `window.Refract` (created lazily from window.React).
import type * as React from 'react';

/* ------------------------------------------------------------------ shared vocab */
export type Tone = 'accent' | 'positive' | 'caution' | 'critical' | 'neutral';
export type Hue = 'coral' | 'amber' | 'green' | 'teal' | 'sky' | 'indigo' | 'violet' | 'rose';
export type Size = 'sm' | 'md' | 'lg';
/** Symbol effects a control's icon plays when it is used (Refract.effect, data-rf-effect). */
export type SymbolEffect = 'bounce' | 'spin' | 'quarter' | 'back' | 'forward' | 'ring' | 'wiggle' | 'drop' | 'lift' | 'right' | 'left' | 'beat' | 'breathe' | 'write' | 'look';
/** regular (default) · thick (menus, sheets, sidebars) · clear (over media, with a Scrim) · tinted (the primary action) · solid */
export type GlassVariant = 'regular' | 'thick' | 'clear' | 'tinted' | 'solid';
/** true = regular strength; 'soft' | 'strong' scale the refraction. Chromium renders it; other engines keep blur, rim and specular. */
/** Refraction strength. Regular and clear glass refract by default where the browser draws it (thick glass when asked); false (or 'off') opts out. */
export type LensStrength = boolean | 'soft' | 'strong' | 'off';
export type ThemeId = 'light' | 'dark' | 'light-contrast' | 'dark-contrast';
export type IconName =
  | 'home' | 'search' | 'bell' | 'person' | 'people' | 'sliders' | 'plus' | 'minus' | 'close' | 'check'
  | 'chevron-left' | 'chevron-right' | 'chevron-down' | 'chevron-up' | 'more' | 'share' | 'heart' | 'star' | 'bookmark'
  | 'trash' | 'pencil' | 'compose' | 'filter' | 'grid' | 'list' | 'calendar' | 'clock' | 'timer' | 'pin' | 'map' | 'compass'
  | 'navigate' | 'camera' | 'image' | 'play' | 'pause' | 'skip-back' | 'skip-forward' | 'shuffle' | 'repeat' | 'volume'
  | 'volume-low' | 'mic' | 'music' | 'send' | 'mail' | 'chat' | 'reply' | 'inbox' | 'archive' | 'folder' | 'doc' | 'copy'
  | 'link' | 'download' | 'upload' | 'lock' | 'eye' | 'sun' | 'moon' | 'cloud' | 'drop' | 'wave' | 'mountain' | 'leaf'
  | 'sparkle' | 'bolt' | 'layers' | 'globe' | 'wifi' | 'info' | 'alert' | 'check-circle' | 'x-circle' | 'plus-circle'
  | 'arrow-right' | 'arrow-left' | 'arrow-up-right' | 'refresh' | 'sidebar' | 'library' | 'bag' | 'tag' | 'flag' | 'chart' | 'sort'
  // added in 1.1
  | 'arrow-up' | 'arrow-down' | 'undo' | 'redo' | 'expand' | 'collapse' | 'more-vertical' | 'menu' | 'settings'
  | 'sign-out' | 'power' | 'zoom-in' | 'scan' | 'crop' | 'wand' | 'brush' | 'text' | 'paperclip' | 'person-add'
  | 'at' | 'phone' | 'video' | 'bell-off' | 'key' | 'unlock' | 'eye-off' | 'shield' | 'cart' | 'card' | 'gift'
  | 'box' | 'display' | 'laptop' | 'keyboard' | 'headphones' | 'battery' | 'airplane' | 'car' | 'bike' | 'tent'
  | 'thermometer' | 'umbrella' | 'snowflake' | 'wind' | 'cloud-rain' | 'flame' | 'question' | 'minus-circle'
  | 'checklist' | 'pulse' | 'hourglass' | 'trophy' | 'lightbulb' | 'book' | 'appearance'
  // added in 1.2
  | 'bluetooth' | 'signal' | 'flashlight' | 'volume-off' | 'rotate-lock' | 'calculator';

/* ------------------------------------------------------------------ vanilla API */
export interface ToastOptions {
  title: string;
  message?: string;
  tone?: Tone;
  /** An icon name, or false for none. Defaults by tone. */
  icon?: IconName | false;
  action?: { label: string; onClick?: () => void };
  /** ms before it lifts away; 0 keeps it until dismissed. Default 4000 (6000 with an action). */
  duration?: number;
  position?: 'top' | 'bottom';
}
export interface DialogOptions {
  title: string;
  message?: string;
  icon?: IconName;
  tone?: 'critical';
  actions?: Array<{ label: string; value?: string; variant?: 'filled' | 'gray' | 'plain' | 'soft'; tone?: Tone; autofocus?: boolean }>;
  /** Backdrop click and Esc close it. Default true. */
  dismissible?: boolean;
}
/** dispersion: how far the rim splits colour (red bends 1 − d, blue 1 + d times as far as green); 0 turns it off. */
export interface LensOptions { bezel?: number; depth?: number; profile?: 'squircle' | 'circle' | 'soft'; dispersion?: number }
/**
 * The glass of a liquid knob or selection: refraction in its rim bezel and a zoom of what is under it.
 * zoom is the zoom when lifted (> 1 magnifies, < 1 pulls back), rest the zoom at rest (default 1: none);
 * refract the px the rim bends when lifted and rim the share of it at rest (default 1); dispersion splits
 * colour at the rim.
 */
export interface LiquidLensOptions { radius?: number; bezel?: number; refract?: number; rim?: number; zoom?: number; rest?: number; dispersion?: number; profile?: 'circle' | 'squircle' | 'soft' }

/** Springs the way SwiftUI describes them: response ≈ seconds to arrive, damping 1 = no overshoot, 0.5 = lively. */
export interface SpringParams { response: number; damping: number }
export declare class Spring {
  constructor(options?: { value?: number; response?: number; damping?: number; precision?: number; onUpdate?: (x: number, v: number) => void; onRest?: (x: number) => void; onWake?: (s: Spring) => void });
  readonly value: number;
  readonly velocity: number;
  readonly moving: boolean;
  target: number;
  /** Head for a new target, keeping the current velocity unless one is given. Interruptible at any moment. */
  to(target: number, options?: { velocity?: number; response?: number; damping?: number }): this;
  /** Set the value now, with no motion. */
  jump(value: number): this;
  /** A kick that springs back to the same target. */
  push(velocity: number): this;
  stop(): this;
}
/**
 * The knob or indicator made of glass (switch knobs, slider thumbs, the segmented control and tab bar
 * selection): frosted at rest, it lifts and clears into a lens. One transform per frame plus --rf-lift
 * (0 resting, 1 lifted) on the element(s); its lens is built for its size and follows the lift.
 */
export declare class Liquid {
  constructor(el: HTMLElement | HTMLElement[], options?: { lift?: [number, number]; stretch?: number; lens?: Partial<LiquidLensOptions>; y?: number });
  x: Spring; w: Spring; lift: Spring; squash: Spring;
  onRender?: (l: Liquid) => void; onLand?: (l: Liquid) => void; onRest?: (l: Liquid) => void;
  /** Put it somewhere with no motion (first layout, resizes). */
  place(x: number, width?: number): this;
  /** The finger is down on it: rise into glass and stay lifted. */
  grab(): this;
  /** Track the finger closely (px). */
  follow(x: number): this;
  /** Travel to x; with lift it rises for the trip and lands solid again (a tap). velocity carries a flick. */
  travel(x: number, options?: { lift?: boolean; velocity?: number; width?: number; spring?: SpringParams }): this;
  /** Let go: settle back into a solid face. */
  drop(): this;
  destroy(): void;
}
export type HapticType = 'selection' | 'soft' | 'light' | 'medium' | 'heavy' | 'rigid' | 'success' | 'warning' | 'error';
export interface DragState { id: number; x0: number; y0: number; x: number; y: number; started: boolean; type: string; target: EventTarget | null; event: PointerEvent }

export type SpringToken = 'spring-smooth' | 'spring-snappy' | 'spring-bouncy' | 'spring-gel' | 'spring-jelly';
export interface Rect { left: number; top: number; width: number; height: number }
export interface MaterializeOptions {
  /** The element or box the surface grows out of (default: a smaller copy of itself). */
  from?: HTMLElement | Rect | null;
  /** The surface's final box when it is not laid out yet (a popover in beforetoggle). */
  rect?: Rect;
  /** Start scale, 0.9 (menus from glass buttons use 0.8). */
  scale?: number;
  /** Fade `from` out while the surface covers it; it comes back on dematerialize. */
  hideSource?: boolean;
  /** Stagger the children in (default true). [role="group"] and [data-rf-stagger] children are staggered individually. */
  content?: boolean;
  /** [x, y] fractions to grow from when there is no source. */
  origin?: [number, number];
  /** Corner radius of a Rect source. */
  radius?: number;
  /** A jelly wobble once it has popped out (0.03 is lively; menus from glass buttons use 0.035). */
  wobble?: number;
  delay?: number;
  duration?: number;
}

export interface RefractAPI {
  version: string;
  /** Enhance everything under root: icons, light, lensing, behaviours. Idempotent. lens: false keeps glass from refracting by default (explicit data-lens still does). */
  init(root?: ParentNode | Element, options?: { light?: boolean; lens?: boolean }): RefractAPI;
  /** Keep enhancing nodes added later (SPAs, streamed HTML). Returns a stop function. */
  observe(root?: Node): () => void;
  /** Detach every behaviour from an element. */
  destroy(el: Element): void;
  /** Re-sync a behaviour after a framework changed state it cannot observe (segmented value, slider value, tab). */
  refresh(el: Element): void;
  /** systemFont: Apple's system font (SF Pro) is what renders; Refract.init() then sets data-rf-font="system" on <html> and applies Apple's tracking. */
  supports: { lens: boolean; backdrop: boolean; popover: boolean; scrollTimeline: boolean; viewTransition: boolean; closedBy: boolean; linear: boolean; systemFont: boolean };
  prefs: { readonly reducedMotion: boolean; readonly reducedTransparency: boolean; readonly contrast: boolean };

  /** Real refraction for one element (Chromium). Returns cleanup. Prefer data-lens in markup. */
  lens(el: HTMLElement, options?: LensOptions): () => void;
  /** A standalone lens filter for custom surfaces; null where unsupported. */
  lensFilter(width: number, height: number, options?: LensOptions & { radius?: number }): { id: string; url: string; remove(): void } | null;
  /** The shared light source that glass rims catch. */
  light: {
    /** Have el's rim follow the light; pseudo names the pseudo-element that draws it (default '::before'). */
    register(el: Element, options?: { pseudo?: '::before' | '::after' }): () => void;
    /** 'pointer' (default; on touch screens it follows the tilt where reported without a prompt), 'orbit' (slow ambient drift), 'fixed', 'tilt' (device motion).
     *  angleDeg: where a fixed light hangs or the orbit starts (0 = above, 90 = right). speed: the orbit's degrees a second (24; half under Reduce Motion). Called with no arguments, returns the current mode. */
    mode(mode?: 'pointer' | 'orbit' | 'fixed' | 'tilt', angleDeg?: number, options?: { speed?: number }): string;
    angle(deg: number): void;
    /** The angle the light comes from now: the angle el's rim shows, or without el the orbit's or fixed light's. */
    current(el?: Element): number;
    requestTilt(): Promise<boolean>;
    refresh(): void;
  };

  theme: {
    get(el?: Element): ThemeId;
    set(id: ThemeId, el?: Element): ThemeId;
    /** Follow the OS colour scheme and Increase Contrast. Returns a stop function. */
    auto(el?: Element): () => void;
    opposite(id: ThemeId): ThemeId;
    /**
     * Flip a small floating glass element light/dark as it crosses content regions marked
     * data-rf-tone="dark" | "light" | "inverse". Attached automatically to [data-rf-adapt]. Returns cleanup.
     */
    adapt(el: HTMLElement, options?: { root?: Element | Document }): () => void;
    /**
     * Glass inside a region marked data-rf-tone takes the region's tone (a night photo stays dark in the
     * light theme; "inverse" follows bg-inverse). Attached automatically to [data-rf-tone]. Returns cleanup.
     */
    region(el: HTMLElement): () => void;
  };
  /** 0 = ultra clear, 0.5 = regular (default), 1 = fully tinted. */
  setDensity(value: number, el?: HTMLElement): number;
  /**
   * Override the system's Reduce Motion setting: 'full' keeps every motion, 'reduced' calms it (no overshoot,
   * travel or squash; light, fades and small motion in place stay), 'system' follows the OS. persist: true
   * remembers it on this site (localStorage) and applies it in every open tab.
   */
  setMotion(mode: 'reduced' | 'full' | 'system', options?: { persist?: boolean }): void;
  /** The motion override in force: 'system' (follow the OS), 'full' or 'reduced'. */
  getMotion(): 'system' | 'full' | 'reduced';
  setTransparency(mode: 'reduced' | 'system'): void;

  icons: Record<IconName, string>;
  /** Inline SVG markup for an icon (currentColor, 1.75 stroke). */
  icon(name: IconName, options?: { size?: 'sm' | 'lg'; label?: string; className?: string }): string;

  toast: ((options: ToastOptions | string) => { el: HTMLElement; close(): void }) & { close(el: HTMLElement): void; dismissAll(): void };
  /** confirm(): a yes or no question in thick glass; resolves true when the person confirms. */
  dialog: {
    open(target: HTMLDialogElement | DialogOptions): Promise<string>;
    confirm(options: { title: string; message?: string; icon?: IconName; tone?: 'critical'; confirm?: string; cancel?: string }): Promise<boolean>;
    close(el: HTMLDialogElement, value?: string): void;
  };
  sheet: {
    open(el: HTMLElement, options?: { detent?: 'small' | 'medium' | 'large' }): Promise<string>;
    close(el: HTMLElement, value?: string): void;
    detent(el: HTMLElement, name: 'small' | 'medium' | 'large'): string;
  };
  /** Menus and popovers materialize out of their trigger. { focus: false } opens without moving focus. */
  /** openAt: a context menu at a point (clientX, clientY); focus returns to whatever had it before. */
  menu: { open(el: HTMLElement, trigger?: HTMLElement, options?: { focus?: boolean }): void; close(el: HTMLElement): void; toggle(el: HTMLElement, trigger?: HTMLElement, options?: { focus?: boolean }): void; openAt(el: HTMLElement, x: number, y: number, options?: { focus?: boolean }): void };
  /** A control becomes the surface it opens (materialize out of it), and dissolves back into it. */
  morph: {
    open(trigger: HTMLElement, surface: HTMLElement, options?: { focus?: boolean }): Promise<void>;
    close(surface: HTMLElement): Promise<void>;
    toggle(trigger: HTMLElement, surface: HTMLElement): Promise<void>;
    transition(update: () => void): Promise<void>;
  };
  /** View transition on the system springs, instant under Reduce Motion. */
  transition(update: () => void): Promise<void>;
  /** Glass on one plane: merge through a liquid neck and snap apart; add and remove pinch in and out. */
  /** Glass groups: pieces on one plane merge through a liquid neck; once they touch they share one body of glass (no seams), and a tinted piece stays a nested pill. */
  group: { merge(el: HTMLElement, merged?: boolean): Promise<void>; add(el: HTMLElement, node: HTMLElement): HTMLElement; remove(node: HTMLElement): void };
  /**
   * Glass forms instead of fading: the shape grows out of `from` while blur, tint, lensing and the rim
   * arrive together (--rf-mat), the light runs round the rim (--rf-sweep), the shadow lifts in last and
   * the content settles in, nearest the source first. Resolves when the shape has settled.
   */
  materialize(el: HTMLElement, options?: MaterializeOptions): Promise<void>;
  /** The reverse: content blurs out, the shape shrinks into its source as the glass dissolves, the source returns. Holds its end state. */
  dematerialize(el: HTMLElement, options?: { to?: HTMLElement | Rect | null; rect?: Rect; scale?: number; content?: boolean; showSource?: boolean; duration?: number }): Promise<void>;
  /** Shape-shift keyed parts ([data-rf-key]) between states: arriving parts bud out, leaving parts pinch off, changed parts flow to their new width. */
  shapeshift(root: HTMLElement, update: () => void, options?: { spring?: SpringToken }): Promise<void>;
  /** Animate a layout change: measure `targets`, run `mutate`, spring each from where it was. Interruptible. */
  flip(targets: Iterable<Element>, mutate?: () => void, options?: { spring?: SpringToken; scale?: boolean }): Promise<void>;
  /** The same keyframes over a list with a rising delay. */
  stagger(nodes: Iterable<Element>, keyframes: Keyframe[], options?: KeyframeAnimationOptions & { each?: number; max?: number; spring?: SpringToken }): Animation[];
  /** Send the light once round a glass rim. */
  sweep(el: HTMLElement, options?: { from?: number; to?: number; duration?: number }): Animation;
  /** Roll a number or short label to a new value in the direction it changed (inputs too); badges bump. */
  roll(el: HTMLElement, value: string | number, options?: { dir?: 1 | -1; from?: string | number }): void;
  /** A small spring pulse on something that just changed. */
  bump(el: HTMLElement): void;
  /**
   * Jelly: a volume-keeping squash-and-stretch wobble that dies away, layered on whatever the element is doing.
   * angle: the axis it stretches along (0 horizontal, 90 vertical). impact: start squashed (a landing) instead of at rest (a release).
   */
  jiggle(el: Element, options?: { angle?: number; amount?: number; duration?: number; freq?: number; delay?: number; impact?: boolean }): Animation;
  /** A rotational wobble that dies away (a symbol shaking itself awake). */
  wiggle(el: Element, options?: { deg?: number; duration?: number; freq?: number; delay?: number }): Animation;
  /**
   * Glass beads spray out of an element (or a point) with a ring of light, arc under a little gravity and pop.
   * `data-rf-burst` on a control does this when it turns on. Never runs under Reduce Motion.
   */
  burst(el: Element, options?: { count?: number; hue?: string; colors?: string[]; size?: [number, number]; spread?: number; gravity?: number; ring?: boolean; x?: number; y?: number; arc?: [number, number] }): void;
  /** Play a symbol effect on an icon; 'auto' picks one by the icon's name (refresh spins, bell rings, download drops). Skipped under Reduce Motion. */
  effect(icon: Element, effect?: SymbolEffect | 'auto' | 'none'): Animation;
  /**
   * Switch between two sibling pages (shown and hidden with the hidden attribute) with the motion that matches
   * the navigation: morph (tabs and segments), slide (steps), push and pop (into and out of a detail), zoom (out of `origin`), fade.
   * `scroll` sets where the scroller holding them starts on the new page. Cross-fades under Reduce Motion.
   */
  page(from: HTMLElement | null, to: HTMLElement, options?: { style?: 'morph' | 'slide' | 'push' | 'pop' | 'zoom' | 'fade'; direction?: 1 | -1; origin?: Element; scroll?: number; duration?: number }): Promise<void>;
  /**
   * Morph el from its current look into the next one: update() changes it (data-art, src, text, children).
   * 'morph' (default) blur cross-fade in place; 'slide' next and previous within the frame (direction 1 | -1);
   * 'zoom' the new look settles from a little larger; 'fade'. Keep glass outside el. A 200ms cross-fade under Reduce Motion.
   */
  swap(el: HTMLElement, update: () => void, options?: { style?: 'morph' | 'slide' | 'zoom' | 'fade'; direction?: 1 | -1; duration?: number }): Promise<void>;
  /** Stop the motion Refract started on a surface. */
  settle(el: HTMLElement): void;
  /** A demo loop that runs only while `root` is on screen and stops for good at the first touch, click or key. Returns stop(). */
  autoplay(step: (i: number) => void, options?: { root?: Element; every?: number; delay?: number }): () => void;
  motion: Pick<RefractAPI, 'materialize' | 'dematerialize' | 'shapeshift' | 'flip' | 'stagger' | 'sweep' | 'roll' | 'bump' | 'settle' | 'autoplay' | 'jiggle' | 'wiggle' | 'burst' | 'effect' | 'page'> & { radiusOf(el: Element, box?: Rect): number };
  /** Web Animations with the system springs; collapses to a fade under Reduce Motion. */
  animate(el: Element, keyframes: Keyframe[], options?: KeyframeAnimationOptions & { spring?: SpringToken; reduced?: Keyframe[] }): Animation;
  /** Interruptible, velocity-aware spring for pointer-driven values. */
  spring(options: { value?: number; stiffness?: number; damping?: number; mass?: number; onUpdate?: (x: number, v: number) => void; onRest?: (x: number) => void }): {
    readonly value: number; readonly velocity: number; set(v: number): void; to(v: number, velocity?: number): void; stop(): void;
  };
  easing(token: string, fallback?: string): string;
  duration(token: string, fallback?: number): number;

  /**
   * Haptics, named the way UIKit names its feedback generators. Android browsers drive the motor; Safari
   * taps on real switches (Refract switches carry the switch attribute); desktops stay silent. Only a
   * person's own input plays one: pass the triggering event. Off with enabled = false or data-rf-haptics="off".
   * Declarative: data-haptic="light" on any element plays on a person's click.
   */
  haptics: {
    enabled: boolean;
    readonly supported: boolean;
    selection(event?: Event): boolean;
    impact(style?: 'soft' | 'light' | 'medium' | 'heavy' | 'rigid', event?: Event): boolean;
    notify(type?: 'success' | 'warning' | 'error', event?: Event): boolean;
    play(type: HapticType, event?: Event): boolean;
  };
  /** The liquid engine behind the switch, slider, segmented control and tab bar, for custom controls. */
  Liquid: typeof Liquid;
  Spring: typeof Spring;
  /** The named springs: lift, drop, travel, follow, gel, pop. */
  SPRINGS: Record<'lift' | 'drop' | 'travel' | 'follow' | 'gel' | 'pop', SpringParams>;
  /** Run fn(dt, t) every frame (one shared loop) until it returns false. Returns unsubscribe. */
  tick(fn: (dt: number, t: number) => boolean | void): () => void;
  /** Pointer velocity over the last 80 ms, in px/s. */
  velocityTracker(windowMs?: number): { add(x: number, y?: number, t?: number): void; get(): { x: number; y: number }; reset(): void };
  /** Apple's rubber band: travel past a limit shrinks smoothly toward `dim` (c = 0.55). */
  rubber(offset: number, dim: number, c?: number): number;
  /** Where a flick would come to rest (UIScrollView's deceleration, rate 0.998). */
  project(velocity: number, rate?: number): number;
  /** One careful drag recogniser: threshold, axis, pointer capture, release velocity, click swallowing. Returns cleanup. */
  drag(el: HTMLElement, options: {
    axis?: 'x' | 'y'; threshold?: number;
    onDown?: (e: PointerEvent, s: DragState) => void; onStart?: (e: PointerEvent, s: DragState) => void;
    onMove?: (e: PointerEvent, s: DragState, dx: number, dy: number, velocity: { x: number; y: number }) => void;
    onEnd?: (e: PointerEvent, s: DragState, velocity: { x: number; y: number }, info: { dragged: boolean; cancelled: boolean }) => void;
    accept?: (e: PointerEvent) => boolean;
  }): () => void;
  /** The refraction filter a Liquid knob uses; shared by size. null where unsupported. */
  /** The glass of a moving part; lift(0..1) turns its zoom and rim from rest to lifted. */
  liquidLens(width: number, height: number, options?: LiquidLensOptions): { id: string; url: string; lift(amount: number): void; remove(): void } | null;
}

/* ------------------------------------------------------------------ events (vanilla)
 * rf-change    tile { pressed } · wheel { index, value } · switch, segmented, tab bar as native change / rf-select
 * rf-input     level { value, fraction } while it moves
 * rf-code      keypad { code } when every digit is in · rf-unlock { code } (with data-code) · rf-cancel
 * rf-settle    wheel { index } once it stops turning
 * rf-refresh   pull to refresh { done() }: call done when the work is finished (data-manual), else it closes itself
 * rf-peek      peek { menu } as the preview lifts
 * rf-swipe-commit  swipe row { action } after a long swipe commits the last action
 * Element handles: list.rfWheel.select(i) · row.rfSwipe.open() / close() · root.rfRefresh.done() / start() · pad.rfKeypad.clear()
 */

/* ------------------------------------------------------------------ React components */
type Native<T> = Omit<React.HTMLAttributes<T>, 'onChange' | 'onToggle' | 'title' | 'onSelect'>;

/** A glass surface. Children sit on the material; never nest glass in glass. */
export interface GlassProps extends Native<HTMLElement> { as?: React.ElementType; variant?: GlassVariant; shape?: 'capsule' | 'circle' | 'rect' | 'panel'; tone?: Tone | Hue; lens?: LensStrength; interactive?: boolean; children?: React.ReactNode }
export declare function Glass(props: GlassProps): React.ReactElement;

/** Demo backdrop (content layer) that gives glass something to bend. */
export interface SceneProps extends Native<HTMLElement> { scene?: 'dunes' | 'lagoon' | 'citrus' | 'night' | 'forest' | 'dusk' | 'stripes' | 'grid' | 'plain'; as?: React.ElementType; children?: React.ReactNode }
export declare function Scene(props: SceneProps): React.ReactElement;

export interface IconProps { name: IconName; size?: 'sm' | 'lg'; label?: string; className?: string }
export declare function Icon(props: IconProps): React.ReactElement;

/** Glass (navigation layer) or content-layer button. `variant: 'tinted'` is the one primary action per view. */
export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: 'glass' | 'tinted' | 'filled' | 'soft' | 'gray' | 'plain';
  tone?: Tone | Hue;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  shape?: 'capsule' | 'circle' | 'rect';
  /** Render as glass (implied by 'glass' and 'tinted'). */
  glass?: boolean;
  lens?: LensStrength;
  loading?: boolean;
  icon?: IconName;
  iconEnd?: IconName;
  /** id of a Menu or Popover to open (popovertarget). */
  menu?: string;
  block?: boolean;
  children?: React.ReactNode;
}
export declare function Button(props: ButtonProps): React.ReactElement;

export interface ToolbarProps extends Native<HTMLDivElement> { position?: 'top' | 'bottom'; label: string; children?: React.ReactNode }
export declare function Toolbar(props: ToolbarProps): React.ReactElement;
/** A glass capsule of plain buttons inside a Toolbar. */
export interface ToolbarGroupProps extends Native<HTMLDivElement> { lens?: LensStrength; children?: React.ReactNode }
export declare function ToolbarGroup(props: ToolbarGroupProps): React.ReactElement;

/** A thick-glass popover menu that grows out of its trigger. Open it with <Button menu={id}>. */
export interface MenuProps extends Native<HTMLDivElement> { id: string; label: string; placement?: 'cover' | 'below'; onSelect?: (detail: { item: HTMLElement; value: string; label: string }) => void; children?: React.ReactNode }
export declare function Menu(props: MenuProps): React.ReactElement;
export interface MenuItemProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> { icon?: IconName; shortcut?: string; tone?: 'critical'; type?: 'item' | 'checkbox' | 'radio'; checked?: boolean; value?: string; keepOpen?: boolean }
export declare function MenuItem(props: MenuItemProps): React.ReactElement;
export declare function MenuSeparator(): React.ReactElement;
export declare function MenuLabel(props: { children?: React.ReactNode }): React.ReactElement;
/** A row of icon tiles at the top of a menu (quick actions). */
export declare function MenuRow(props: { children?: React.ReactNode }): React.ReactElement;
export declare function MenuTile(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName }): React.ReactElement;

/** Rich content in thick glass, anchored to its trigger. Open it with <Button menu={id}>. */
export interface PopoverProps extends Native<HTMLDivElement> { id: string; label: string; placement?: 'cover' | 'below'; children?: React.ReactNode }
export declare function Popover(props: PopoverProps): React.ReactElement;

export interface TabItem { id?: string; label: string; icon: IconName; href?: string; badge?: React.ReactNode }
/** A floating glass capsule of 3 to 5 destinations with a liquid selection lens. */
export interface TabBarProps { items: TabItem[]; value?: string | number; onChange?: (id: string | number) => void; position?: 'bottom'; minimizeOnScroll?: string; search?: boolean; onSearch?: () => void; accessory?: React.ReactNode; label?: string; lens?: LensStrength; className?: string }
export declare function TabBar(props: TabBarProps): React.ReactElement;

/** Glass buttons at the edges; the inline title and scroll edge appear once the large title scrolls away. */
export interface NavBarProps { title: React.ReactNode; leading?: React.ReactNode; trailing?: React.ReactNode; scroller?: string; inlineTitle?: boolean; className?: string }
export declare function NavBar(props: NavBarProps): React.ReactElement;
export declare function LargeTitle(props: { children?: React.ReactNode; as?: React.ElementType }): React.ReactElement;
export interface ScrollEdgeProps { edge?: 'top' | 'bottom'; hard?: boolean; scroller?: string; sticky?: boolean }
export declare function ScrollEdge(props: ScrollEdgeProps): React.ReactElement;

export interface SidebarProps { label: string; collapsed?: boolean; float?: boolean; header?: React.ReactNode; lens?: LensStrength; className?: string; children?: React.ReactNode }
export declare function Sidebar(props: SidebarProps): React.ReactElement;
export declare function SidebarHeading(props: { children?: React.ReactNode }): React.ReactElement;
export interface SidebarItemProps { icon?: IconName; label: string; count?: React.ReactNode; badge?: React.ReactNode; current?: boolean; href?: string; onClick?: () => void }
export declare function SidebarItem(props: SidebarItemProps): React.ReactElement;

export interface SegmentOption { value: string; label?: string; icon?: IconName; ariaLabel?: string }
/** 2 to 5 mutually exclusive options; the thumb stretches as it travels and turns to a lens when dragged. */
export interface SegmentedControlProps { options: SegmentOption[]; value?: string; defaultValue?: string; onChange?: (value: string) => void; name?: string; label: string; size?: Size; glass?: boolean; block?: boolean; className?: string }
export declare function SegmentedControl(props: SegmentedControlProps): React.ReactElement;

export interface PageDotsProps { count: number; index?: number; onChange?: (index: number) => void; glass?: boolean | 'clear'; label?: string; className?: string }
export declare function PageDots(props: PageDotsProps): React.ReactElement;

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'size'> { label?: React.ReactNode; tone?: 'accent'; size?: 'sm'; row?: boolean; onChange?: (checked: boolean, e: React.ChangeEvent<HTMLInputElement>) => void }
export declare function Switch(props: SwitchProps): React.ReactElement;

export interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'defaultValue'> { value?: number; defaultValue?: number; min?: number; max?: number; step?: number; onChange?: (value: number, e: React.ChangeEvent<HTMLInputElement>) => void; label: string; iconStart?: IconName; iconEnd?: IconName; ticks?: number; variant?: 'scrubber' }
export declare function Slider(props: SliderProps): React.ReactElement;

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> { label?: string; hint?: string; error?: string; icon?: IconName; clearable?: boolean; onClear?: () => void; multiline?: boolean; variant?: 'filled' }
export declare function TextField(props: TextFieldProps): React.ReactElement;

export interface SearchFieldProps extends React.InputHTMLAttributes<HTMLInputElement> { label?: string; glass?: boolean; collapsible?: boolean; mic?: boolean; onMic?: () => void }
export declare function SearchField(props: SearchFieldProps): React.ReactElement;

export interface StepperProps { value?: number; defaultValue?: number; min?: number; max?: number; step?: number; onChange?: (value: number) => void; label: string; glass?: boolean; className?: string }
export declare function Stepper(props: StepperProps): React.ReactElement;

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> { label: React.ReactNode; description?: React.ReactNode; indeterminate?: boolean }
export declare function Checkbox(props: CheckboxProps): React.ReactElement;
export interface RadioProps extends React.InputHTMLAttributes<HTMLInputElement> { label: React.ReactNode; description?: React.ReactNode }
export declare function Radio(props: RadioProps): React.ReactElement;

export interface DialogAction { label: string; value?: string; variant?: 'filled' | 'gray' | 'plain' | 'soft'; tone?: Tone; autoFocus?: boolean }
/** A modal alert in thick glass. Controlled by `open`; onClose receives the chosen action value or 'dismiss'. */
export interface DialogProps { open: boolean; onClose?: (value: string) => void; title: React.ReactNode; message?: React.ReactNode; icon?: IconName; tone?: 'critical'; actions?: DialogAction[]; dismissible?: boolean; children?: React.ReactNode; className?: string }
export declare function Dialog(props: DialogProps): React.ReactElement;

export type Detent = 'small' | 'medium' | 'large';
/** Rises from the bottom edge: inset glass at medium, full-width and solid at large. */
export interface SheetProps { open: boolean; onClose?: (value: string) => void; detent?: Detent; detents?: Detent[]; onDetentChange?: (d: Detent) => void; title?: React.ReactNode; leading?: React.ReactNode; trailing?: React.ReactNode; inline?: boolean; children?: React.ReactNode; className?: string }
export declare function Sheet(props: SheetProps): React.ReactElement;

/** A live status capsule (upload, timer, call) that expands into a card in place. */
export interface ActivityCapsuleProps { icon?: IconName; tone?: Hue; title: React.ReactNode; subtitle?: React.ReactNode; trailing?: React.ReactNode; expanded?: boolean; onToggle?: (expanded: boolean) => void; children?: React.ReactNode; className?: string }
export declare function ActivityCapsule(props: ActivityCapsuleProps): React.ReactElement;

/** Content-layer surface. variant 'media' fills with art and carries a clear-glass caption. */
export interface CardProps { variant?: 'media'; media?: React.ReactNode; art?: 1 | 2 | 3 | 4 | 5 | 6; eyebrow?: React.ReactNode; title?: React.ReactNode; text?: React.ReactNode; footer?: React.ReactNode; caption?: React.ReactNode; href?: string; onClick?: () => void; tilt?: boolean; className?: string; children?: React.ReactNode }
export declare function Card(props: CardProps): React.ReactElement;

export interface ListProps { header?: React.ReactNode; footer?: React.ReactNode; label?: string; className?: string; children?: React.ReactNode }
export declare function List(props: ListProps): React.ReactElement;
export interface ListRowProps { icon?: IconName; tone?: Hue; thumb?: 1 | 2 | 3 | 4 | 5 | 6; avatar?: AvatarProps; title: React.ReactNode; subtitle?: React.ReactNode; detail?: React.ReactNode; chevron?: boolean; accessory?: React.ReactNode; href?: string; onClick?: () => void }
export declare function ListRow(props: ListRowProps): React.ReactElement;

export interface AvatarProps { initials?: string; src?: string; alt?: string; size?: 'xs' | 'sm' | 'lg' | 'xl'; tone?: Hue; status?: 'online' | 'away' | 'busy'; label?: string }
export declare function Avatar(props: AvatarProps): React.ReactElement;
export declare function AvatarStack(props: { people: AvatarProps[]; max?: number; label?: string }): React.ReactElement;

/** Counts (solid) or status (soft, with an icon and a word). Pops when its content changes. */
export interface BadgeProps { tone?: Tone; variant?: 'soft' | 'dot'; icon?: IconName; label?: string; children?: React.ReactNode }
export declare function Badge(props: BadgeProps): React.ReactElement;

/** A filter (pressed / onToggle) or a removable token (onRemove). */
export interface ChipProps { pressed?: boolean; onToggle?: (pressed: boolean) => void; onRemove?: () => void; removeLabel?: string; glass?: boolean; className?: string; children?: React.ReactNode }
export declare function Chip(props: ChipProps): React.ReactElement;

/** value 0..1; omit value for indeterminate. */
export interface ProgressProps { value?: number; label: string; size?: 'lg'; tone?: 'positive' }
export declare function Progress(props: ProgressProps): React.ReactElement;
export interface RingProps { value: number; label: string; size?: Size; tone?: 'positive'; showValue?: boolean }
export declare function Ring(props: RingProps): React.ReactElement;
/** Twelve indeterminate spinners in currentColor; pick by meaning (bars = audio, fill = transfer, dots = typing). */
export interface SpinnerProps { size?: Size | 'xl'; variant?: 'arc' | 'activity' | 'ring' | 'dots' | 'bars' | 'pulse' | 'orbit' | 'liquid' | 'morph' | 'fill' | 'merge'; label?: string }
export declare function Spinner(props: SpinnerProps): React.ReactElement;
/** The Refract mark in CSS (currentColor). animate: true loops (whole, apart, hold, rejoin); 'once' comes apart once and stays the mark. For Refract's own tools. */
export interface MarkProps { size?: 'sm' | 'md' | 'lg' | 'xl'; animate?: boolean | 'once'; label?: string; className?: string }
export declare function Mark(props: MarkProps): React.ReactElement;
export interface SkeletonProps { shape?: 'circle' | 'block' | 'title'; width?: string; height?: string }
export declare function Skeleton(props: SkeletonProps): React.ReactElement;

export interface PlayPauseProps { playing: boolean; onToggle?: (playing: boolean) => void; size?: 'sm'; labelPlay?: string; labelPause?: string }
export declare function PlayPause(props: PlayPauseProps): React.ReactElement;
/** Clear glass player controls over artwork, with a dimming scrim. Times in seconds. */
export interface MediaControlsProps { title: React.ReactNode; subtitle?: React.ReactNode; art?: 1 | 2 | 3 | 4 | 5 | 6; artwork?: React.ReactNode; playing: boolean; onToggle?: (playing: boolean) => void; position?: number; duration?: number; onSeek?: (t: number) => void; onPrevious?: () => void; onNext?: () => void; className?: string }
export declare function MediaControls(props: MediaControlsProps): React.ReactElement;

/** Glass shapes on one plane: they merge into one capsule and pinch apart again. */
/** Changing `merged` after the first render animates the merge or split (liquid neck). */
export interface GlassGroupProps { merged?: boolean; label: string; className?: string; children?: React.ReactNode }
export declare function GlassGroup(props: GlassGroupProps): React.ReactElement;
/** A draggable magnifying lens (keyboard: arrow keys). */
export declare function Loupe(props: { size?: number; x?: number; y?: number; label?: string }): React.ReactElement;
/** Alias of Loupe: the draggable lens shown on the Lens card. */
export declare const Lens: typeof Loupe;
/** A drop of tinted liquid glass that buds up to three actions. fan 'up-left' (default, for a bottom-right corner) or 'up-right' (bottom-left). */
export declare function Droplets(props: { icon?: IconName; label?: string; fan?: 'up-left' | 'up-right'; actions: Array<{ icon: IconName; label: string; onSelect?: () => void }> }): React.ReactElement;
/** Scroll-driven entrance; effect 'scale' | 'blur' | 'glass' or true for rise. */
export declare function Reveal(props: { as?: React.ElementType; effect?: true | 'scale' | 'blur' | 'glass'; children?: React.ReactNode } & React.HTMLAttributes<HTMLElement>): React.ReactElement;
/** Dimming layer under clear glass on media. */
export declare function Scrim(props: { edge?: 'top' | 'both' | 'full' }): React.ReactElement;

/** A glass toggle tile (Control Center). Controlled (`pressed` + onChange) or uncontrolled (defaultPressed). shape 'circle' for the small round ones (label becomes aria-label). */
export interface TileProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> { icon?: IconName; label: string; sub?: React.ReactNode; subOff?: React.ReactNode; pressed?: boolean; defaultPressed?: boolean; onChange?: (pressed: boolean) => void; tone?: Hue | 'critical'; shape?: 'circle' }
export declare function Tile(props: TileProps): React.ReactElement;
/** A thick glass panel that holds round tiles in a 2 by 2 cluster. */
export declare function TileCluster(props: { children?: React.ReactNode; className?: string }): React.ReactElement;
/** A tall (or, with orientation 'horizontal', wide) glass level that fills: drag anywhere, it stretches past the ends. */
export interface LevelProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'> { icon?: IconName; label: string; value?: number; defaultValue?: number; min?: number; max?: number; onChange?: (value: number) => void; orientation?: 'horizontal' }
export declare function Level(props: LevelProps): React.ReactElement;
/** A passcode keypad. onComplete(code) when every digit is in. `code` checks locally: for demos only, never for real secrets. */
export interface KeypadProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> { length?: number; code?: string; label?: string; onComplete?: (code: string) => void; onUnlock?: (code: string) => void; onCancel?: () => void }
export declare function Keypad(props: KeypadProps): React.ReactElement;
/** Wheels on a drum (time, date, any list): drag, flick, scroll or keys; a glass band magnifies the value. onChange(values) once a wheel settles on a row. */
export interface WheelPickerWheel {
  label: string;
  options: Array<string | number>;
  value?: string | number;
  align?: 'start' | 'end';
  /** Go round for ever (hours, minutes); needs eight options or more. */
  loop?: boolean;
  /** A unit that stays put beside the value in the band ("min"); unitOne is used when the value is 1 ("hour"). */
  unit?: string;
  unitOne?: string;
  /** Options shown faint that the wheel will not rest on (Feb 30). */
  disabled?: Array<string | number>;
}
export interface WheelPickerProps { wheels: WheelPickerWheel[]; label?: string; onChange?: (values: Array<string | null>) => void; className?: string }
/** Behaviour handle on an enhanced .rf-wheel element. */
export interface RefractWheel { select(index: number, smooth?: boolean): void; readonly index: number; readonly value: string | null; readonly options: HTMLElement[] }
export declare function WheelPicker(props: WheelPickerProps): React.ReactElement;
/** Pull the content down from its top to refresh. onRefresh may return a promise; the spinner stays until it settles. */
export interface PullToRefreshProps { onRefresh?: () => void | Promise<unknown>; children?: React.ReactNode; className?: string }
export declare function PullToRefresh(props: PullToRefreshProps): React.ReactElement;
/** Press and hold (or right-click) to lift a preview and open the Menu whose id is `menu`. */
export interface PeekProps extends React.HTMLAttributes<HTMLElement> { menu: string; as?: React.ElementType; children?: React.ReactNode }
export declare function Peek(props: PeekProps): React.ReactElement;
/** A List row with actions behind it: swipe (or drag) to reveal; a long swipe commits a last critical action. */
export interface SwipeRowProps extends ListRowProps { label?: string; actions: Array<{ label: string; icon?: IconName; tone?: Hue | 'critical'; onSelect?: () => void }> }
export declare function SwipeRow(props: SwipeRowProps): React.ReactElement;

declare global {
  interface Window {
    Refract: RefractAPI & {
      Glass: typeof Glass; Scene: typeof Scene; Icon: typeof Icon; Button: typeof Button; Toolbar: typeof Toolbar; ToolbarGroup: typeof ToolbarGroup;
      Menu: typeof Menu; MenuItem: typeof MenuItem; MenuSeparator: typeof MenuSeparator; MenuLabel: typeof MenuLabel; MenuRow: typeof MenuRow; MenuTile: typeof MenuTile;
      Popover: typeof Popover; TabBar: typeof TabBar; NavBar: typeof NavBar; LargeTitle: typeof LargeTitle; ScrollEdge: typeof ScrollEdge;
      Sidebar: typeof Sidebar; SidebarHeading: typeof SidebarHeading; SidebarItem: typeof SidebarItem; SegmentedControl: typeof SegmentedControl;
      PageDots: typeof PageDots; Switch: typeof Switch; Slider: typeof Slider; TextField: typeof TextField; SearchField: typeof SearchField;
      Stepper: typeof Stepper; Checkbox: typeof Checkbox; Radio: typeof Radio; Dialog: typeof Dialog; Sheet: typeof Sheet;
      ActivityCapsule: typeof ActivityCapsule; Card: typeof Card; List: typeof List; ListRow: typeof ListRow; Avatar: typeof Avatar;
      AvatarStack: typeof AvatarStack; Badge: typeof Badge; Chip: typeof Chip; Progress: typeof Progress; Ring: typeof Ring; Spinner: typeof Spinner;
      Skeleton: typeof Skeleton; PlayPause: typeof PlayPause; MediaControls: typeof MediaControls; GlassGroup: typeof GlassGroup; Loupe: typeof Loupe;
      Lens: typeof Loupe; Droplets: typeof Droplets; Reveal: typeof Reveal; Scrim: typeof Scrim;
      Tile: typeof Tile; TileCluster: typeof TileCluster; Level: typeof Level; Keypad: typeof Keypad; WheelPicker: typeof WheelPicker;
      PullToRefresh: typeof PullToRefresh; Peek: typeof Peek; SwipeRow: typeof SwipeRow; Mark: typeof Mark;
    };
  }
}
