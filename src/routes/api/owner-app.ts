// The owner-rooted API sub-app. Every route mounted here is shared between
// the dashboard's `/api/*` mount and the on-site editor's `/__api/*` mount —
// the prefixes are auth-mode gates (Clerk session vs. edit-token) but the
// handler surface is identical. Keeping the routes in this one sub-app and
// mounting it twice in src/index.ts prevents the parallel mount lists from
// drifting (e.g. a new endpoint added to /api but forgotten at /__api).
//
// Owner-only-on-dashboard routes (collaborators, sites CRUD, themes, a11y,
// password admin, addons, profile, on-site-edit popup, library/custom-template
// admin) stay separately mounted on /api/* in src/index.ts — the editor never
// hits them, and mirroring them under /__api would dilute the auth-mode
// invariant that /__api/* is editor-only.

import { Hono } from 'hono';
import canvasApi from './canvas';
import canvasAgentApi from './canvas-agent';
import publishApi from './publish';
import sectionsApi from './sections';
import slotHistoryApi from './slot-history';
import ownerAssetsApi from '../../assets/route';
import { librarySectionsOwner } from './library-sections';
import { customTemplatesOwner } from './custom-templates';
import notificationsApi from './notifications';
import chatApi from '../../agent/chat/route';
import { entriesRoute } from './entries';
import type { PublicEnv } from '../public';

const ownerApi = new Hono<PublicEnv>();

ownerApi.route('/canvas', canvasApi);
ownerApi.route('/canvas-agent', canvasAgentApi);
ownerApi.route('/publish', publishApi);
ownerApi.route('/owner/assets', ownerAssetsApi);
ownerApi.route('/', slotHistoryApi);
ownerApi.route('/', sectionsApi);
ownerApi.route('/library', librarySectionsOwner);
ownerApi.route('/custom-templates', customTemplatesOwner);
ownerApi.route('/', notificationsApi);
ownerApi.route('/sites', chatApi);
// ADR 0060 — CMS entries. Mounting through ownerApi automatically exposes
// the routes on both /api/sites/:siteId/entries (Clerk auth, dashboard)
// AND /__api/sites/:siteId/entries (edit-token auth, on-site editor).
// entriesRoute paths are `/` and `/:entryId`; the `:siteId` parameter is
// extracted from the mount path here.
ownerApi.route('/sites/:siteId/entries', entriesRoute);

export default ownerApi;
