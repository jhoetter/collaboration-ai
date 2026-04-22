/**
 * Icon set used throughout the chat surface.
 *
 * We re-export `lucide-react` icons under stable `Icon*` aliases so the
 * rest of the codebase can swap to a different icon family later without
 * touching every call site (and so we keep parity with `office-ai` and
 * `hof-os`, which both standardise on lucide).
 *
 * Lucide's default `size` is 24 px, which renders far too large for our
 * dense Slack-style toolbars. We wrap every icon to default to **14 px**
 * with a hairline 1.75 stroke, matching `office-ai`'s toolbar conventions.
 * Callers can still override with `<IconBold size={16} />` when needed.
 */
import {
  Activity,
  ArrowDown,
  AtSign,
  Bell,
  BellOff,
  Bold,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code,
  Code2,
  Copy,
  Download,
  ExternalLink,
  File,
  Hash,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Lock,
  LogOut,
  Mic,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Quote,
  Reply,
  Search,
  Send,
  Smile,
  Star,
  Strikethrough,
  Trash2,
  Type,
  Underline,
  UserPlus,
  Users,
  Video,
  X,
  type LucideProps,
} from "lucide-react";
import { forwardRef } from "react";

/** Public icon prop shape — alias of `LucideProps`. */
export type IconProps = LucideProps;

/** Default visual size for our icons (px). Office-ai uses the same value. */
const DEFAULT_SIZE = 14;
/** Slightly thinner than lucide's default 2 — feels less chunky at 14 px. */
const DEFAULT_STROKE = 1.75;

type LucideIcon = (typeof Bold) & { displayName?: string };

/**
 * Wrap a raw `lucide-react` icon so it inherits our project-wide
 * defaults (`size`, `strokeWidth`) while still accepting overrides.
 */
function withDefaults(Icon: LucideIcon, displayName: string) {
  const Wrapped = forwardRef<SVGSVGElement, LucideProps>((props, ref) => (
    <Icon
      ref={ref}
      size={DEFAULT_SIZE}
      strokeWidth={DEFAULT_STROKE}
      {...props}
    />
  ));
  Wrapped.displayName = displayName;
  return Wrapped;
}

export const IconActivity = withDefaults(Activity, "IconActivity");
export const IconArrowDown = withDefaults(ArrowDown, "IconArrowDown");
export const IconAt = withDefaults(AtSign, "IconAt");
export const IconBell = withDefaults(Bell, "IconBell");
export const IconBellOff = withDefaults(BellOff, "IconBellOff");
export const IconBold = withDefaults(Bold, "IconBold");
export const IconBookmark = withDefaults(Bookmark, "IconBookmark");
export const IconCheck = withDefaults(Check, "IconCheck");
export const IconChevronDown = withDefaults(ChevronDown, "IconChevronDown");
export const IconChevronLeft = withDefaults(ChevronLeft, "IconChevronLeft");
export const IconChevronRight = withDefaults(ChevronRight, "IconChevronRight");
export const IconClose = withDefaults(X, "IconClose");
export const IconCode = withDefaults(Code, "IconCode");
export const IconCodeBlock = withDefaults(Code2, "IconCodeBlock");
export const IconCopy = withDefaults(Copy, "IconCopy");
export const IconDownload = withDefaults(Download, "IconDownload");
export const IconExternal = withDefaults(ExternalLink, "IconExternal");
export const IconFile = withDefaults(File, "IconFile");
export const IconHash = withDefaults(Hash, "IconHash");
export const IconImage = withDefaults(ImageIcon, "IconImage");
export const IconItalic = withDefaults(Italic, "IconItalic");
export const IconLink = withDefaults(Link2, "IconLink");
export const IconListBullet = withDefaults(List, "IconListBullet");
export const IconListNumbered = withDefaults(ListOrdered, "IconListNumbered");
export const IconLock = withDefaults(Lock, "IconLock");
export const IconLogOut = withDefaults(LogOut, "IconLogOut");
export const IconMic = withDefaults(Mic, "IconMic");
export const IconMore = withDefaults(MoreHorizontal, "IconMore");
export const IconPaperclip = withDefaults(Paperclip, "IconPaperclip");
export const IconPencil = withDefaults(Pencil, "IconPencil");
export const IconPin = withDefaults(Pin, "IconPin");
export const IconPlus = withDefaults(Plus, "IconPlus");
export const IconQuote = withDefaults(Quote, "IconQuote");
export const IconReply = withDefaults(Reply, "IconReply");
export const IconSearch = withDefaults(Search, "IconSearch");
export const IconSend = withDefaults(Send, "IconSend");
export const IconSmile = withDefaults(Smile, "IconSmile");
export const IconStar = withDefaults(Star, "IconStar");
export const IconStrike = withDefaults(Strikethrough, "IconStrike");
export const IconTrash = withDefaults(Trash2, "IconTrash");
export const IconType = withDefaults(Type, "IconType");
export const IconUnderline = withDefaults(Underline, "IconUnderline");
export const IconUserPlus = withDefaults(UserPlus, "IconUserPlus");
export const IconUsers = withDefaults(Users, "IconUsers");
export const IconVideo = withDefaults(Video, "IconVideo");
