import type { SVGProps } from 'react';
import {
  Pause as LucidePause,
  Play as LucidePlay,
  Settings2 as LucideSettings2,
  Volume2 as LucideVolume2,
  VolumeX as LucideVolumeX,
  HelpCircle as LucideHelpCircle,
  Bot as LucideBot,
  Copy as LucideCopy,
  Check as LucideCheck,
  MessageSquare as LucideMessageSquare,
  Send as LucideSend,
  X as LucideX,
  Bell as LucideBell,
  BellOff as LucideBellOff,
  Hourglass as LucideHourglass,
  ClipboardCheck as LucideClipboardCheck,
  Radiation as LucideRadiation,
  Shield as LucideShield,
  ShieldCheck as LucideShieldCheck,
  ShieldHalf as LucideShieldHalf,
  Castle as LucideCastle,
  Swords as LucideSwords,
  Radar as LucideRadar,
  Eye as LucideEye,
  Crosshair as LucideCrosshair,
  Factory as LucideFactory,
  SquareDashedMousePointer as LucideSquareDashedMousePointer,
  SquareDashed as LucideSquareDashed,
  Hexagon as LucideHexagon,
  Globe as LucideGlobe,
  Palette as LucidePalette,
  MonitorCog as LucideMonitorCog,
  User as LucideUser,
  Users as LucideUsers,
  BookOpen as LucideBookOpen,
  Download as LucideDownload,
  Truck as LucideTruck,
  CircleDashed as LucideCircleDashed,
  Target as LucideTarget,
  Rocket as LucideRocket,
  Bomb as LucideBomb,
  SatelliteDish as LucideSatelliteDish,
  Ear as LucideEar,
  Zap as LucideZap,
  Plane as LucidePlane,
  Columns3 as LucideColumns3,
  Grid2x2 as LucideGrid2x2,
  Square as LucideSquare,
  Maximize2 as LucideMaximize2,
  Ban as LucideBan,
  Maximize as LucideMaximize,
  Minimize as LucideMinimize,
  LogOut as LucideLogOut,
  Keyboard as LucideKeyboard,
  Power as LucidePower,
  RotateCwSquare as LucideRotateCwSquare,
  TabletSmartphone as LucideTabletSmartphone,
  Terminal as LucideTerminal,
} from 'lucide-react';

/** The shape every icon here has — so callers can take one as a prop without importing lucide. */
export type { LucideIcon } from 'lucide-react';

export const PauseIcon = LucidePause;
export const PlayIcon = LucidePlay;
export const Settings2Icon = LucideSettings2;
export const Volume2Icon = LucideVolume2;
export const VolumeXIcon = LucideVolumeX;
export const HelpCircleIcon = LucideHelpCircle;
export const BotIcon = LucideBot;
export const CopyIcon = LucideCopy;
export const CheckIcon = LucideCheck;
export const MessageSquareIcon = LucideMessageSquare;
export const SendIcon = LucideSend;
export const XIcon = LucideX;
export const BellIcon = LucideBell;
export const BellOffIcon = LucideBellOff;
/** A networked match standing still — waiting on the peer, or on our own socket. */
export const HourglassIcon = LucideHourglass;
/* The titlebar's two new controls. `Maximize`/`Minimize` — the plain corner
   brackets — rather than the arrow pair `Maximize2` already spoken for by the
   spread formation, and a door-with-an-arrow for the way out of a match. */
export const MaximizeIcon = LucideMaximize;
export const MinimizeIcon = LucideMinimize;
export const LogOutIcon = LucideLogOut;
/* The controls reference, in both places that open it: the HUD titlebar and the
   title screen's settings bar. A keyboard rather than the `?` it used to carry —
   in the sidebar that glyph is the Directives card's own help button one card
   below, and the same symbol must not mean two things there. */
export const KeyboardIcon = LucideKeyboard;

/** The HUD's Command card: its header. A terminal prompt — the sidebar's other
 * candidates all mean something else in it already (a factory is the build tile,
 * a shield is a directive), and this is the section the player gives orders from. */
export const TerminalIcon = LucideTerminal;

/* The HUD's Directives card: its header, then one icon per program (see TASK_ICONS). */
export const ClipboardCheckIcon = LucideClipboardCheck;
export const ShieldIcon = LucideShield;
export const ShieldCheckIcon = LucideShieldCheck;
export const CastleIcon = LucideCastle;
export const SwordsIcon = LucideSwords;
export const RadarIcon = LucideRadar;
export const EyeIcon = LucideEye;
export const CrosshairIcon = LucideCrosshair;

/* The Command section's three action tiles. The dome deliberately does NOT take
   ShieldIcon/ShieldCheckIcon — both already stand for a directive one card below,
   and the same glyph must not mean two things in one sidebar. A hexagon reads as
   a force field and is spoken for by nothing. */
export const FactoryIcon = LucideFactory;
export const SelectAllIcon = LucideSquareDashedMousePointer;
/** Its opposite, and drawn as one: the same marquee with the cursor taken out. */
export const ClearSelectionIcon = LucideSquareDashed;
export const DomeIcon = LucideHexagon;

/* The title screen: the global settings bar, then one per navigation entry. */
export const GlobeIcon = LucideGlobe;
export const PaletteIcon = LucidePalette;
export const GraphicsIcon = LucideMonitorCog;
export const UserIcon = LucideUser;
export const UsersIcon = LucideUsers;
export const BookOpenIcon = LucideBookOpen;
/* The rail's link out to the desktop build. A plain download arrow rather than
   MonitorDown: `GraphicsIcon` is already a monitor two zones away on the very
   same screen, and the arrow says "leaves the page" without competing with it. */
export const DownloadIcon = LucideDownload;
/* Its mirror: the entry that quits the desktop app, shown only there. A power
   symbol, because this ends the process rather than navigating anywhere. */
export const PowerIcon = LucidePower;

/* The two device notices (`ui/features/device/`). The rotation arrow turns
   clockwise because that is the direction a right-handed player turns a tablet,
   and the pair of screens says "small" without naming a phone — the same notice
   covers an iPad in Split View and a dragged-down desktop window. */
export const RotateDeviceIcon = LucideRotateCwSquare;
export const SmallScreenIcon = LucideTabletSmartphone;

/* The rail's link out to the game's Discord. Hand-drawn rather than imported:
   Lucide ships no brand marks, and a generic speech bubble is already spoken for
   by `MessageSquare` (= in-match chat). Kept on Lucide's own geometry — a 24-unit
   box, `currentColor`, sized by the same `size` prop — so it sits in a row of
   Lucide icons without looking like a guest. Filled, because the mark is a
   silhouette and a stroked outline of it reads as noise at 16px. */
export function DiscordIcon({ size = 24, ...props }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...props}
    >
      <path d="M19.27 5.33A16.4 16.4 0 0 0 15.16 4l-.28.55a12 12 0 0 1 3.4 1.4 15.6 15.6 0 0 0-12.56 0 12 12 0 0 1 3.4-1.4L8.84 4a16.4 16.4 0 0 0-4.11 1.33C2.1 9.28 1.39 13.13 1.74 16.92a16.6 16.6 0 0 0 5.07 2.58l1.1-1.53a10.8 10.8 0 0 1-1.71-.83l.42-.33a11.9 11.9 0 0 0 10.76 0l.42.33c-.54.33-1.11.6-1.71.83l1.1 1.53a16.6 16.6 0 0 0 5.07-2.58c.42-4.39-.71-8.2-2.99-11.59ZM8.52 14.65c-.99 0-1.8-.91-1.8-2.03s.79-2.03 1.8-2.03 1.82.92 1.8 2.03c0 1.12-.8 2.03-1.8 2.03Zm6.96 0c-.99 0-1.8-.91-1.8-2.03s.79-2.03 1.8-2.03 1.82.92 1.8 2.03c0 1.12-.79 2.03-1.8 2.03Z" />
    </svg>
  );
}

/* The build modal's chassis cards (see CHASSIS_ICONS); legs reuse BotIcon above. */
export const TruckIcon = LucideTruck;
export const CircleDashedIcon = LucideCircleDashed;

/* The build modal's weapon cards (see WEAPON_ICONS). Two of them dodge a glyph that
   already means something one row below: the cannon takes Target rather than Swords
   (= Attack Robots), and the radar takes a dish rather than RadarIcon (= Search &
   Detect) — the same symbol must not stand for two things in one dialog. */
export const TargetIcon = LucideTarget;
export const RocketIcon = LucideRocket;
export const BombIcon = LucideBomb;
export const SatelliteDishIcon = LucideSatelliteDish;
export const EarIcon = LucideEar;
export const ZapIcon = LucideZap;
export const PlaneIcon = LucidePlane;

/* The hull's service menu (`ui/hud/ServiceMenu.tsx`). Neither glyph is one the
   sidebar is already using while the panel is on screen: ShieldIcon and
   ShieldCheckIcon are the Guard and Defend Base directives one card away, and the
   hexagon is the base's dome. A half shield still reads "shield" at a glance —
   which is the mode's name — without being either of those, and the radiation
   burst says "everything in this circle stops" better than the lightning bolt
   does, that one being the `dew` weapon in the build dialog. */
export const ShieldHalfIcon = LucideShieldHalf;
export const RadiationIcon = LucideRadiation;

/**
 * Formation shapes. Each glyph is read as the plan view of the shape itself:
 * stacked bars for a file, bars abreast for a rank, and so on — the label only
 * confirms what the tile already says.
 */
export const LineFormationIcon = LucideColumns3;
export const BoxFormationIcon = LucideSquare;
export const SpreadFormationIcon = LucideMaximize2;
export const NoFormationIcon = LucideBan;
/**
 * The Command tile that opens the formation dialog — the subject rather than any
 * one shape. A four-cell grid: none of the four choices owns it, and it collides
 * with nothing else in the rail (the square below is `BoxFormationIcon`, which
 * only ever appears inside the dialog now).
 */
export const FormationIcon = LucideGrid2x2;
