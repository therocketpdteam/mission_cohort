import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#0B5C75",
      light: "#2E829B",
      dark: "#073F51"
    },
    secondary: {
      main: "#F2A900",
      dark: "#B87F00"
    },
    background: {
      default: "#F4F7FA",
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
          borderColor: "#DDE4EC",
          boxShadow: "none"
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
      styleOverrides: {
        root: {
          borderColor: "#DDE4EC",
          backgroundColor: "#FFFFFF"
        },
        columnHeaders: {
          backgroundColor: "#F8FAFC"
        },
        cell: {
          outline: "none"
        }
      }
    }
  }
});
