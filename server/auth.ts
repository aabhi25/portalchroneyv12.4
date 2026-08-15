import bcrypt from "bcrypt";
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { sessions, users, accountGroupAdmins, accountGroupMembers, accountGroups } from "@shared/schema";
import { eq, and, gt, inArray } from "drizzle-orm";

const SALT_ROUNDS = 12;
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

// Password hashing
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Session management
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function createSession(userId: string): Promise<string> {
  const sessionToken = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION);

  await db.insert(sessions).values({
    userId,
    sessionToken,
    expiresAt,
  });

  return sessionToken;
}

export async function validateSession(sessionToken: string) {
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.sessionToken, sessionToken),
        gt(sessions.expiresAt, new Date())
      )
    )
    .limit(1);

  if (!session) {
    return null;
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!user) return null;
  
  return {
    ...user,
    activeBusinessAccountId: session.activeBusinessAccountId || user.businessAccountId,
  };
}

export async function updateSessionActiveAccount(sessionToken: string, activeBusinessAccountId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ activeBusinessAccountId })
    .where(eq(sessions.sessionToken, sessionToken));
}

export async function deleteSession(sessionToken: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.sessionToken, sessionToken));
}

// Extend Express Request type to include user info
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        role: string;
        businessAccountId: string | null;
        activeBusinessAccountId: string | null;
        mustChangePassword: string;
        tempPasswordExpiry: Date | null;
        lastLoginAt: Date | null;
      };
      sessionToken?: string;
    }
  }
}

// Authentication middleware
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sessionToken = req.cookies?.session;

  if (!sessionToken) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const user = await validateSession(sessionToken);

  if (!user) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  req.sessionToken = sessionToken;
  req.user = {
    id: user.id,
    username: user.username,
    role: user.role,
    businessAccountId: user.activeBusinessAccountId || user.businessAccountId,
    activeBusinessAccountId: user.activeBusinessAccountId,
    mustChangePassword: user.mustChangePassword,
    tempPasswordExpiry: user.tempPasswordExpiry,
    lastLoginAt: user.lastLoginAt,
  };

  next();
}

// Role-based authorization middleware
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    next();
  };
}

// Middleware to ensure business user only accesses their own data
export function requireBusinessAccount(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  // SuperAdmins can access all data (handled by businessAccountId parameter in routes)
  if (req.user.role === "super_admin") {
    return next();
  }

  // Business users must have a business account
  if (!req.user.businessAccountId) {
    return res.status(403).json({ error: "No business account associated" });
  }

  next();
}

// Get business account IDs that a group admin can access for a specific group
export async function getGroupAdminAccountIdsForGroup(userId: string, groupId: string): Promise<string[]> {
  // Verify user has admin access to this group
  const [assignment] = await db
    .select()
    .from(accountGroupAdmins)
    .where(and(
      eq(accountGroupAdmins.userId, userId),
      eq(accountGroupAdmins.groupId, groupId)
    ))
    .limit(1);
  
  if (!assignment) {
    return [];
  }
  
  // Get all business account IDs from this group
  const groupMembers = await db
    .select({ businessAccountId: accountGroupMembers.businessAccountId })
    .from(accountGroupMembers)
    .where(eq(accountGroupMembers.groupId, groupId));
  
  // Deduplicate account IDs
  return Array.from(new Set(groupMembers.map(m => m.businessAccountId)));
}

// Get all groups a user is an admin for
export async function getGroupAdminAssignments(userId: string) {
  const assignments = await db
    .select({
      groupId: accountGroupAdmins.groupId,
      groupName: accountGroups.name,
      canViewConversations: accountGroupAdmins.canViewConversations,
      canViewLeads: accountGroupAdmins.canViewLeads,
      canViewAnalytics: accountGroupAdmins.canViewAnalytics,
      canExportData: accountGroupAdmins.canExportData,
    })
    .from(accountGroupAdmins)
    .innerJoin(accountGroups, eq(accountGroupAdmins.groupId, accountGroups.id))
    .where(eq(accountGroupAdmins.userId, userId));
  
  // Convert string permissions to booleans for client consumption
  return assignments.map(a => ({
    groupId: a.groupId,
    groupName: a.groupName,
    canViewConversations: a.canViewConversations === "true",
    canViewLeads: a.canViewLeads === "true",
    canViewAnalytics: a.canViewAnalytics === "true",
    canExportData: a.canExportData === "true",
  }));
}

// Get group admin permissions for a user for a SPECIFIC group (must provide groupId)
export async function getGroupAdminPermissions(userId: string, groupId: string) {
  const [assignment] = await db
    .select()
    .from(accountGroupAdmins)
    .where(and(
      eq(accountGroupAdmins.userId, userId),
      eq(accountGroupAdmins.groupId, groupId)
    ))
    .limit(1);
  
  if (!assignment) {
    return null;
  }
  
  // Return permissions for this specific group only
  return {
    canViewConversations: assignment.canViewConversations === "true",
    canViewLeads: assignment.canViewLeads === "true",
    canViewAnalytics: assignment.canViewAnalytics === "true",
    canExportData: assignment.canExportData === "true",
    groupId: assignment.groupId,
  };
}

// Middleware to require account group admin access
export function requireGroupAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (req.user.role !== "account_group_admin") {
    return res.status(403).json({ error: "Group admin access required" });
  }

  next();
}
