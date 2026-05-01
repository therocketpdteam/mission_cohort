import type {} from "@mui/x-data-grid/themeAugmentation";
import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#075B73",
      light: "#2E8AA5",
      dark: "#073847"
    },
    secondary: {
      main: "#F4B23D",
      dark: "#B87910"
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
      default: "#F3F6F8",
      paper: "#FFFFFF"
    },
    text: {
      primary: "#17202A",
      secondary: "#5D6B7A"
    },
    divider: "#DDE4EC"
  },
  shape: {
    borderRadius: 8
  },
  typography: {
    fontFamily: "Arial, Helvetica, sans-serif",
    h1: { fontSize: "2rem", fontWeight: 700 },
    h2: { fontSize: "1.55rem", fontWeight: 700 },
    h3: { fontSize: "1.25rem", fontWeight: 700 },
    h4: { fontSize: "1.1rem", fontWeight: 700 },
    button: { textTransform: "none", fontWeight: 700 }
  },
  components: {
    MuiButton: {
      defaultProps: {
        size: "small",
        variant: "contained"
      },
      styleOverrides: {
        root: {
          minHeight: 34
        }
      }
    },
    MuiCard: {
      defaultProps: {
        variant: "outlined"
      },
      styleOverrides: {
        root: {
          borderColor: "#DDE7ED",
          boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)"
        }
      }
    },
    MuiTextField: {
      defaultProps: {
        size: "small"
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
          borderColor: "#DDE7ED",
          backgroundColor: "#FFFFFF"
        },
        columnHeaders: {
          backgroundColor: "#F7FAFC"
        },
        cell: {
          outline: "none"
        }
      }
    }
  }
});
