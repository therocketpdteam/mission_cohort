import type {} from "@mui/x-data-grid/themeAugmentation";
import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#1479C9",
      light: "#E8F5FC",
      dark: "#0B67AD",
      contrastText: "#FFFFFF"
    },
    secondary: {
      main: "#20C7D9",
      light: "#E6FAFC",
      dark: "#0E8796",
      contrastText: "#071D33"
    },
    success: {
      main: "#16A34A",
      light: "#DCFCE7",
      dark: "#166534"
    },
    warning: {
      main: "#D97706",
      light: "#FEF3C7",
      dark: "#92400E"
    },
    error: {
      main: "#DC2626",
      light: "#FEE2E2",
      dark: "#B91C1C"
    },
    background: {
      default: "#F8FAFC",
      paper: "#FFFFFF"
    },
    text: {
      primary: "#0F172A",
      secondary: "#64748B"
    },
    divider: "#E2E8F0"
  },
  shape: {
    borderRadius: 12
  },
  typography: {
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
    h1: { fontSize: "2rem", fontWeight: 900, letterSpacing: 0, color: "#071D33" },
    h2: { fontSize: "1.48rem", fontWeight: 900, letterSpacing: 0, color: "#071D33" },
    h3: { fontSize: "1.16rem", fontWeight: 900, letterSpacing: 0, color: "#071D33" },
    h4: { fontSize: "1rem", fontWeight: 850, letterSpacing: 0, color: "#071D33" },
    body1: { fontSize: "0.95rem", color: "#0F172A" },
    body2: { fontSize: "0.86rem" },
    button: { textTransform: "none", fontWeight: 700, letterSpacing: 0 }
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ":root": {
          "--color-primary-900": "#071D33",
          "--color-primary-800": "#0B2A45",
          "--color-primary-700": "#123C5A",
          "--color-blue-600": "#1479C9",
          "--color-blue-500": "#1E9BDE",
          "--color-blue-100": "#E8F5FC",
          "--color-cyan-500": "#20C7D9",
          "--color-cyan-100": "#E6FAFC",
          "--color-orange-500": "#F59E0B",
          "--color-orange-100": "#FFF3D6",
          "--color-success-600": "#16A34A",
          "--color-success-100": "#DCFCE7",
          "--color-warning-600": "#D97706",
          "--color-warning-100": "#FEF3C7",
          "--color-danger-600": "#DC2626",
          "--color-danger-100": "#FEE2E2",
          "--color-white": "#FFFFFF",
          "--color-slate-50": "#F8FAFC",
          "--color-slate-100": "#F1F5F9",
          "--color-slate-200": "#E2E8F0",
          "--color-slate-500": "#64748B",
          "--color-slate-700": "#334155",
          "--color-slate-900": "#0F172A"
        }
      }
    },
    MuiButton: {
      defaultProps: {
        variant: "contained"
      },
      styleOverrides: {
        root: ({ ownerState }) => ({
          minHeight: 40,
          borderRadius: 12,
          boxShadow: "none",
          paddingInline: 16,
          whiteSpace: "nowrap",
          "&:hover": {
            boxShadow: "0 10px 22px rgba(20, 121, 201, 0.18)"
          },
          "&.Mui-disabled": {
            backgroundColor: "#E2E8F0",
            color: "#94A3B8",
            cursor: "not-allowed",
            boxShadow: "none"
          },
          ...(ownerState.size === "small" && {
            minHeight: 34,
            borderRadius: 10,
            paddingInline: 12
          })
        }),
        containedPrimary: {
          backgroundColor: "#1479C9",
          color: "#FFFFFF",
          "&:hover": {
            backgroundColor: "#0B67AD"
          }
        },
        containedSecondary: {
          backgroundColor: "#20C7D9",
          color: "#071D33",
          "&:hover": {
            backgroundColor: "#18AFC0"
          }
        },
        containedError: {
          backgroundColor: "#DC2626",
          color: "#FFFFFF",
          "&:hover": {
            backgroundColor: "#B91C1C"
          }
        },
        outlined: {
          backgroundColor: "#FFFFFF",
          borderColor: "#CBD5E1",
          color: "#123C5A",
          "&:hover": {
            backgroundColor: "#F1F5F9",
            borderColor: "#94A3B8"
          }
        },
        outlinedPrimary: {
          color: "#1479C9",
          borderColor: "#1479C9",
          "&:hover": {
            backgroundColor: "#E8F5FC",
            borderColor: "#1479C9"
          }
        },
        text: {
          color: "#334155",
          "&:hover": {
            backgroundColor: "#F1F5F9"
          }
        }
      }
    },
    MuiCard: {
      defaultProps: {
        variant: "outlined"
      },
      styleOverrides: {
        root: {
          borderColor: "#E2E8F0",
          borderRadius: 16,
          boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04), 0 14px 30px rgba(15, 23, 42, 0.05)"
        }
      }
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: 24,
          "&:last-child": {
            paddingBottom: 24
          }
        }
      }
    },
    MuiTextField: {
      defaultProps: {
        size: "small"
      },
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            minHeight: 40,
            borderRadius: 12,
            backgroundColor: "#FFFFFF",
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: "#1479C9"
            },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: "#1479C9",
              borderWidth: 2
            }
          },
          "& .MuiFormHelperText-root": {
            color: "#64748B"
          }
        }
      }
    },
    MuiFormControl: {
      defaultProps: {
        size: "small"
      }
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          paddingTop: 8,
          paddingBottom: 8
        }
      }
    },
    MuiDataGrid: {
      defaultProps: {
        density: "compact",
        disableRowSelectionOnClick: true
      },
      styleOverrides: {
        root: {
          borderColor: "#E2E8F0",
          backgroundColor: "#FFFFFF",
          borderRadius: 16,
          boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)"
        },
        columnHeaders: {
          backgroundColor: "#F8FAFC",
          color: "#334155",
          fontWeight: 800
        },
        row: {
          "&:hover": {
            backgroundColor: "#F8FAFC"
          }
        },
        cell: {
          outline: "none"
        }
      }
    },
    MuiDialogActions: {
      styleOverrides: {
        root: {
          borderTop: "1px solid #E2E8F0",
          padding: "16px 24px",
          gap: 8,
          flexWrap: "wrap"
        }
      }
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: {
          color: "#071D33",
          fontWeight: 900
        }
      }
    },
    MuiPaper: {
      styleOverrides: {
        outlined: {
          borderColor: "#E2E8F0"
        }
      }
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: "#FFFFFF"
        }
      }
    }
  }
});
