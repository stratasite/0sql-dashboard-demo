/**
 * The demo's stand-in for your own authentication.
 *
 * Every 0sql request carries a security context: who the query is for. The
 * `Regional Cost Visibility` policy in semantic/security.yml reads the
 * `region:` tag on the caller's groups and filters cost measures to those
 * regions, in the SQL, at plan time.
 *
 * In your application this comes from the session — never from the browser,
 * and never from the model. The chat agent has no way to change it: it is
 * added on the server, after the agent has produced its spec.
 */
import type { SecurityContext } from '@/types';

export interface DemoUser {
  id: string;
  label: string;
  /** What the picker says this user can see. */
  blurb: string;
  context: SecurityContext;
}

export const users: DemoUser[] = [
  {
    id: 'amer',
    label: 'Dana — AMER ops',
    blurb: 'Cost measures filtered to AMER sites',
    context: {
      email: 'dana@example.com',
      groups: [{ name: 'CS Ops AMER', tags: ['region:AMER'] }],
    },
  },
  {
    id: 'apac',
    label: 'Ravi — APAC ops',
    blurb: 'Cost measures filtered to APAC sites',
    context: {
      email: 'ravi@example.com',
      groups: [{ name: 'CS Ops APAC', tags: ['region:APAC'] }],
    },
  },
  {
    id: 'global',
    label: 'Mo — global finance',
    blurb: 'Cost measures across every region',
    context: {
      email: 'mo@example.com',
      groups: [
        { name: 'CS Finance', tags: ['region:AMER', 'region:EMEA', 'region:APAC'] },
      ],
    },
  },
  {
    id: 'agent',
    label: 'Sam — floor supervisor',
    blurb: 'No region granted: cost measures return no rows',
    context: {
      email: 'sam@example.com',
      groups: [{ name: 'CS Floor' }],
    },
  },
];

export const defaultUser = users[0];

export function userById(id: string | undefined | null): DemoUser {
  return users.find((u) => u.id === id) ?? defaultUser;
}
