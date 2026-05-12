import type {} from "@mui/x-data-grid/themeAugmentation";
import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#075C70",
      light: "#E8F6F7",
      dark: "#062F3D"
    },
    secondary: {
      main: "#E6A935",
      light: "#FFF5D9",
      dark: "#94640A"
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
      default: "#F7F5EF",
      paper: "#FFFFFF"
    },
    text: {
      primary: "#101B2B",
      secondary: "#657389"
    },
    divider: "#E4E8EC"
  },
  shape: {
    borderRadius: 10
  },
  typography: {
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
    h1: { fontSize: "2rem", fontWeight: 900, letterSpacing: 0 },
    h2: { fontSize: "1.48rem", fontWeight: 900, letterSpacing: 0 },
    h3: { fontSize: "1.16rem", fontWeight: 900, letterSpacing: 0 },
    h4: { fontSize: "1rem", fontWeight: 900, letterSpacing: 0 },
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
          borderRadius: 10,
          boxShadow: "none",
          "&:hover": {
            boxShadow: "0 8px 18px rgba(7, 92, 112, 0.14)"
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
          borderColor: "#E4E8EC",
          borderRadius: 14,
          boxShadow: "0 1px 2px rgba(16, 27, 43, 0.04), 0 16px 34px rgba(16, 27, 43, 0.05)"
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
            backgroundColor: "#FFFFFF",
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: "#075C70"
            }
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
          borderRadius: 14
        },
        columnHeaders: {
          backgroundColor: "#FBFAF7",
          color: "#445166",
          fontWeight: 800
        },
        row: {
          "&:hover": {
            backgroundColor: "#FBFAF7"
          }
        },
        cell: {
          outline: "none"
        }
      }
    }
  }
});
