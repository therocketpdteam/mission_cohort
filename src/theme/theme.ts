import type {} from "@mui/x-data-grid/themeAugmentation";
import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#0B5F75",
      light: "#E5F4F7",
      dark: "#063947"
    },
    secondary: {
      main: "#E7A93C",
      light: "#FFF4DA",
      dark: "#A96805"
    },
    success: {
      main: "#25855A"
    },
    warning: {
      main: "#C97A16"
    },
    error: {
      main: "#B42318"
    },
    background: {
      default: "#F6F8FA",
      paper: "#FFFFFF"
    },
    text: {
      primary: "#17212B",
      secondary: "#647386"
    },
    divider: "#E2E8F0"
  },
  shape: {
    borderRadius: 10
  },
  typography: {
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
    h1: { fontSize: "1.95rem", fontWeight: 800, letterSpacing: 0 },
    h2: { fontSize: "1.45rem", fontWeight: 800, letterSpacing: 0 },
    h3: { fontSize: "1.15rem", fontWeight: 800, letterSpacing: 0 },
    h4: { fontSize: "1rem", fontWeight: 800, letterSpacing: 0 },
    body1: { fontSize: "0.95rem" },
    body2: { fontSize: "0.86rem" },
    button: { textTransform: "none", fontWeight: 800, letterSpacing: 0 }
  },
  components: {
    MuiButton: {
      defaultProps: {
        size: "small",
        variant: "contained"
      },
      styleOverrides: {
        root: {
          minHeight: 34,
          borderRadius: 8,
          boxShadow: "none"
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
          boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04), 0 12px 28px rgba(15, 23, 42, 0.03)"
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
            borderRadius: 10,
            backgroundColor: "#FFFFFF"
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
          borderRadius: 10
        },
        columnHeaders: {
          backgroundColor: "#F8FAFC",
          color: "#475569",
          fontWeight: 800
        },
        cell: {
          outline: "none"
        }
      }
    }
  }
});
