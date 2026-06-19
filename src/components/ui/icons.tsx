"use client";

import {
  Archive,
  Ban,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Edit,
  Eye,
  FileText,
  Gauge,
  CircleHelp,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  Menu,
  Moon,
  MoreHorizontal,
  Plus,
  Power,
  RefreshCw,
  Send,
  Settings,
  Sun,
  Trash2,
  UserCircle,
  UserRoundX,
  Users,
  X
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  fontSize?: "small" | "medium" | "large" | "inherit";
};

function icon(Component: ComponentType<SVGProps<SVGSVGElement>>) {
  return function AppIcon({ fontSize, width, height, ...props }: IconProps) {
    const size = width ?? height ?? (fontSize === "small" ? 16 : fontSize === "large" ? 24 : 18);
    return <Component aria-hidden="true" width={size} height={size} strokeWidth={2} {...props} />;
  };
}

export const AccountCircle = icon(UserCircle);
export const AddIcon = icon(Plus);
export const AddLinkOutlined = icon(Plus);
export const ArchiveOutlined = icon(Archive);
export const ArticleOutlined = icon(FileText);
export const BlockOutlined = icon(Ban);
export const CalendarMonthOutlined = icon(Calendar);
export const CancelOutlined = icon(X);
export const CheckCircleOutline = icon(CheckCircle);
export const CloseIcon = icon(X);
export const ContentCopyOutlined = icon(ClipboardCopy);
export const DashboardOutlined = icon(Gauge);
export const DeleteOutline = icon(Trash2);
export const DoneAllOutlined = icon(CheckCircle);
export const EditOutlined = icon(Edit);
export const EmailOutlined = icon(Mail);
export const ExpandLessOutlined = icon(ChevronUp);
export const ExpandMoreOutlined = icon(ChevronDown);
export const GroupsOutlined = icon(Users);
export const HelpOutline = icon(CircleHelp);
export const InsightsOutlined = icon(Gauge);
export const KeyOutlined = icon(KeyRound);
export const LockOutlined = icon(Lock);
export const LogoutOutlined = icon(LogOut);
export const MenuIcon = icon(Menu);
export const MoonOutlined = icon(Moon);
export const MoreHorizIcon = icon(MoreHorizontal);
export const PersonOffOutlined = icon(UserRoundX);
export const PowerSettingsNewOutlined = icon(Power);
export const ReplayOutlined = icon(RefreshCw);
export const SendOutlined = icon(Send);
export const SettingsOutlined = icon(Settings);
export const SunOutlined = icon(Sun);
export const VisibilityOutlined = icon(Eye);
