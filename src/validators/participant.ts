import { AttendanceStatus, ParticipantStatus } from "@prisma/client";
import { z } from "zod";

export const participantCreateSchema = z.object({
  registrationId: z.string().min(1),
  cohortId: z.string().min(1),
  organizationId: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email("Participant must have a valid email"),
  title: z.string().optional(),
  phone: z.string().optional(),
  status: z.nativeEnum(ParticipantStatus).default(ParticipantStatus.REGISTERED),
  attendanceStatus: z.nativeEnum(AttendanceStatus).default(AttendanceStatus.UNKNOWN),
  certificateIssued: z.boolean().default(false),
  certificateUrl: z.string().url().optional()
});

export const participantUpdateSchema = participantCreateSchema.partial();
