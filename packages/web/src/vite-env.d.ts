/// <reference types="vite/client" />

// The DASHBOARD declares no build variable, and this file is now empty of them
// to say so: the dashboard is published as one built artifact, so an origin baked
// into it would ship to every install that ran it. Its worker origin is the
// document's own, and its control plane origin arrives on the `/data-plane`
// descriptor at runtime.
//
// `VITE_CONTROL_PLANE_URL` and `VITE_PUBLIC_DIRECTORY_URL` moved to
// `src/marketing/vite-env.d.ts` with the entry split. Both belong to the private
// half of this workspace, which is a site legitimately built knowing its own
// origins.
