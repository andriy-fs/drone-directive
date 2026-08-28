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
  Shield as LucideShield,
  ShieldCheck as LucideShieldCheck,
  Castle as LucideCastle,
  Swords as LucideSwords,
  Radar as LucideRadar,
  Eye as LucideEye,
  Crosshair as LucideCrosshair,
  Factory as LucideFactory,
  SquareDashedMousePointer as LucideSquareDashedMousePointer,
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
  Square as LucideSquare,
  Maximize2 as LucideMaximize2,
  Ban as LucideBan,
  Maximize as LucideMaximize,
  Minimize as LucideMinimize,
  LogOut as LucideLogOut,
  Keyboard as LucideKeyboard,
  Power as LucidePower,
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

/**
 * Formation shapes. Each glyph is read as the plan view of the shape itself:
 * stacked bars for a file, bars abreast for a rank, and so on — the label only
 * confirms what the tile already says.
 */
export const LineFormationIcon = LucideColumns3;
export const BoxFormationIcon = LucideSquare;
export const SpreadFormationIcon = LucideMaximize2;
export const NoFormationIcon = LucideBan;
