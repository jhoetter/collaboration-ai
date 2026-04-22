/**
 * Icon set used throughout the chat surface.
 *
 * We re-export `lucide-react` icons under stable `Icon*` aliases so the
 * rest of the codebase can swap to a different icon family later without
 * touching every call site (and so we keep parity with `office-ai` and
 * `hof-os`, which both standardise on lucide).
 *
 * Each icon accepts the standard lucide props (`size`, `strokeWidth`,
 * `color`, `className`, …); strokes default to `currentColor` so they
 * pick up `text-*` utilities and adapt to the active theme automatically.
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

/**
 * Public icon prop shape — alias of `LucideProps` so we can extend it
 * later (custom `tone`, animation, …) without touching call sites.
 */
export type IconProps = LucideProps;

export const IconActivity = Activity;
export const IconArrowDown = ArrowDown;
export const IconAt = AtSign;
export const IconBell = Bell;
export const IconBellOff = BellOff;
export const IconBold = Bold;
export const IconBookmark = Bookmark;
export const IconCheck = Check;
export const IconChevronDown = ChevronDown;
export const IconChevronLeft = ChevronLeft;
export const IconChevronRight = ChevronRight;
export const IconClose = X;
export const IconCode = Code;
export const IconCodeBlock = Code2;
export const IconCopy = Copy;
export const IconDownload = Download;
export const IconExternal = ExternalLink;
export const IconFile = File;
export const IconHash = Hash;
export const IconImage = ImageIcon;
export const IconItalic = Italic;
export const IconLink = Link2;
export const IconListBullet = List;
export const IconListNumbered = ListOrdered;
export const IconLock = Lock;
export const IconLogOut = LogOut;
export const IconMic = Mic;
export const IconMore = MoreHorizontal;
export const IconPaperclip = Paperclip;
export const IconPencil = Pencil;
export const IconPin = Pin;
export const IconPlus = Plus;
export const IconQuote = Quote;
export const IconReply = Reply;
export const IconSearch = Search;
export const IconSend = Send;
export const IconSmile = Smile;
export const IconStar = Star;
export const IconStrike = Strikethrough;
export const IconTrash = Trash2;
export const IconType = Type;
export const IconUnderline = Underline;
export const IconUserPlus = UserPlus;
export const IconUsers = Users;
export const IconVideo = Video;
