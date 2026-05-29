"use client";

import { LockOutlined } from "@/components/ui/icons";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Typography
} from "@/components/ui/primitives";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { adminApi } from "@/lib/adminApi";

export function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await adminApi("/api/auth/login", {
        method: "POST",
        body: { email, password }
      });
      router.replace((searchParams.get("next") || "/dashboard") as Route);
      router.refresh();
    } catch (loginError) {
      setError((loginError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        bgcolor: "background.default",
        px: 2
      }}
    >
      <Card sx={{ width: "100%", maxWidth: 460 }}>
        <CardContent>
          <Stack spacing={2.5} component="form" onSubmit={submit}>
            <Stack spacing={0.75}>
              <Typography variant="h1">Mission Control</Typography>
              <Typography color="text.secondary">
                Secure RocketPD admin access for cohort operations.
              </Typography>
            </Stack>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              fullWidth
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              fullWidth
            />
            <Button type="submit" startIcon={<LockOutlined />} disabled={loading}>
              {loading ? "Signing in" : "Sign In"}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
