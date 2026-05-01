"use client";

import {
  AccountCircle,
  ArticleOutlined,
  CalendarMonthOutlined,
  DashboardOutlined,
  EmailOutlined,
  GroupsOutlined,
  InsightsOutlined,
  LogoutOutlined,
  Menu as MenuIcon,
  SettingsOutlined
} from "@mui/icons-material";
import {
  AppBar,
  Avatar,
  Box,
  Breadcrumbs,
  Button,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Typography,
  useMediaQuery
} from "@mui/material";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useMemo, useState } from "react";
import { useTheme } from "@mui/material/styles";

const drawerWidth = 268;

const navItems: ReadonlyArray<{
  label: string;
  href: Route;
  icon: ReactNode;
}> = [
  { label: "Dashboard", href: "/dashboard", icon: <DashboardOutlined /> },
  { label: "Cohorts", href: "/cohorts", icon: <CalendarMonthOutlined /> },
  { label: "Registrations", href: "/registrations", icon: <ArticleOutlined /> },
  { label: "Participants", href: "/participants", icon: <GroupsOutlined /> },
  { label: "Communications", href: "/communications", icon: <EmailOutlined /> },
  { label: "Reports", href: "/reports", icon: <InsightsOutlined /> },
  { label: "Settings", href: "/settings", icon: <SettingsOutlined /> }
];

function titleFromPath(pathname: string) {
  const current = navItems.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  return current?.label ?? "Mission Control";
}

function breadcrumbsFor(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  return ["Mission Control", ...parts.map((part) => part.replace(/-/g, " "))];
}

export function AppShell({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("lg"));
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const title = titleFromPath(pathname);
  const crumbs = useMemo(() => breadcrumbsFor(pathname), [pathname]);

  if (pathname.startsWith("/reports/share/")) {
    return <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>{children}</Box>;
  }

  const drawer = (
    <Stack sx={{ height: "100%", bgcolor: "#082E3A", color: "#F6F7F9" }}>
      <Box sx={{ px: 2.5, py: 2.5 }}>
        <Typography variant="h3" sx={{ color: "white" }}>
          RocketPD
        </Typography>
        <Typography variant="body2" sx={{ color: "#B6C4D2", mt: 0.5 }}>
          Mission Control
        </Typography>
      </Box>
      <Divider sx={{ borderColor: "rgba(255,255,255,0.12)" }} />
      <List sx={{ px: 1.25, py: 1.5 }}>
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <ListItemButton
              component={Link}
              href={item.href}
              key={item.href}
              selected={active}
              onClick={() => setMobileOpen(false)}
              sx={{
                borderRadius: 1,
                mb: 0.5,
                color: active ? "#FFFFFF" : "#DDE7F0",
                "&.Mui-selected": {
                  bgcolor: "rgba(244,178,61,0.18)",
                  borderLeft: "3px solid #F4B23D",
                  color: "#FFFFFF"
                },
                "&:hover": {
                  bgcolor: "rgba(255,255,255,0.08)"
                }
              }}
            >
              <ListItemIcon sx={{ color: "inherit", minWidth: 38 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14, fontWeight: 700 }} />
            </ListItemButton>
          );
        })}
      </List>
    </Stack>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          width: { lg: `calc(100% - ${drawerWidth}px)` },
          ml: { lg: `${drawerWidth}px` }
        }}
      >
        <Toolbar sx={{ gap: 2 }}>
          <IconButton
            color="inherit"
            edge="start"
            onClick={() => setMobileOpen(true)}
            sx={{ display: { lg: "none" } }}
            aria-label="Open navigation"
          >
            <MenuIcon />
          </IconButton>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h2" noWrap>
              {title}
            </Typography>
            <Breadcrumbs maxItems={3} sx={{ fontSize: 12, color: "text.secondary" }}>
              {crumbs.map((crumb) => (
                <Typography key={crumb} variant="caption" sx={{ textTransform: "capitalize" }}>
                  {crumb}
                </Typography>
              ))}
            </Breadcrumbs>
          </Box>
          <Button variant="outlined" color="inherit" startIcon={<AccountCircle />} onClick={(event) => setMenuAnchor(event.currentTarget)}>
            Admin
          </Button>
          <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            <MenuItem disabled>
              <Avatar sx={{ width: 24, height: 24, mr: 1 }}>A</Avatar>
              Internal Admin
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => setMenuAnchor(null)}>
              <LogoutOutlined fontSize="small" sx={{ mr: 1 }} />
              Logout placeholder
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { lg: drawerWidth }, flexShrink: { lg: 0 } }}>
        <Drawer
          variant={isDesktop ? "permanent" : "temporary"}
          open={isDesktop || mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            "& .MuiDrawer-paper": {
              width: drawerWidth,
              boxSizing: "border-box",
              borderRight: 0
            }
          }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { lg: `calc(100% - ${drawerWidth}px)` },
          pt: 11,
          px: { xs: 2, md: 3 },
          pb: 4
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
