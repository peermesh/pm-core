# Dashboard Demo Mode - Frontend Implementation

**Work Order:** WO-PMDL-2026-01-19-001
**Subtask:** Frontend Implementation
**Status:** Complete
**Date:** 2026-01-18

## Summary

Implemented frontend changes to support demo/guest mode in the Docker Lab Dashboard. This includes a guest access button on the login page, a visible guest mode indicator on the dashboard, and automatic disabling of action buttons for guest users.

## Files Modified

### 1. `services/dashboard/static/login.html`

**Changes:**
- Added "Demo Access Section" with an "Enter as Guest (View Only)" button
- Button only appears when demo mode is enabled (checks `/api/config`)
- Button POSTs to `/api/guest-login` and redirects to dashboard on success
- Amber/gold color scheme to distinguish from primary login

**Key Code Snippet - Guest Access Button:**
```html
<!-- Guest/Demo Access Button - Only shown when demo mode is enabled -->
<div id="demo-access-section" class="mt-6 pt-6 border-t border-slate-700 hidden">
    <p class="text-center text-slate-400 text-sm mb-4">
        Or explore without signing in
    </p>
    <button
        type="button"
        id="guest-access-btn"
        class="w-full py-3 px-4 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg..."
    >
        <svg><!-- Eye icon --></svg>
        Enter as Guest (View Only)
    </button>
    <p class="text-center text-slate-500 text-xs mt-2">
        Demo mode - actions are disabled
    </p>
</div>
```

**JavaScript Logic:**
- Checks `/api/config` for `demo_mode_enabled` flag
- If enabled, shows the guest access section
- Handles guest login with loading state and error handling

### 2. `services/dashboard/static/index.html`

**Changes:**
- Added guest mode banner at the top of the page
- Added guest badge in the header next to the logo
- Added comprehensive session check and guest mode handler script

**Key Code Snippet - Guest Mode Banner:**
```html
<!-- Guest Mode Banner - shown when user is in demo/guest mode -->
<div id="guest-mode-banner" class="bg-amber-600 text-white py-2 px-4 text-center text-sm font-medium hidden">
    <div class="max-w-7xl mx-auto flex items-center justify-center">
        <svg><!-- Eye icon --></svg>
        <span>Demo Mode - View Only</span>
        <a href="/login" class="ml-4 underline hover:no-underline">Sign in for full access</a>
    </div>
</div>
```

**Key Code Snippet - Guest Badge:**
```html
<!-- Guest badge shown inline with header -->
<span id="guest-badge" class="ml-4 px-2 py-1 bg-amber-600/20 text-amber-400 text-xs font-medium rounded hidden">
    Guest
</span>
```

**Session Check JavaScript:**
- Fetches `/api/session` to check if user is a guest
- If `session.is_guest` is true:
  - Shows the guest mode banner
  - Shows the guest badge
  - Calls `disableGuestActions()` to disable action buttons
- Uses MutationObserver to handle dynamically added content

**Guest Action Disabling:**
- Targets buttons with `data-action`, HTMX attributes (`hx-post`, `hx-delete`, etc.)
- Adds `guest-disabled` class for styling
- Sets `disabled` and `aria-disabled` attributes
- Adds tooltip "Login required for this action"
- Prevents click events for disabled elements
- Shows visual tooltip on click attempt

### 3. `services/dashboard/static/css/custom.css`

**Changes:**
- Added comprehensive `.guest-disabled` styles
- Added guest tooltip animation
- Added guest mode banner slide animation
- Added guest badge pulse animation

**Key CSS:**
```css
/* Guest mode disabled elements */
.guest-disabled {
    opacity: 0.5;
    cursor: not-allowed !important;
    pointer-events: none;
    position: relative;
}

button.guest-disabled {
    background-color: var(--color-bg-tertiary) !important;
    border-color: var(--color-border) !important;
    color: var(--color-text-muted) !important;
}

/* Guest tooltip animation */
.guest-tooltip {
    animation: guest-tooltip-appear 0.2s ease-out;
}

/* Guest mode banner animation */
#guest-mode-banner {
    animation: guest-banner-slide 0.3s ease-out;
}
```

## UI Preview Descriptions

### Login Page (Demo Mode Enabled)
- Standard login form at top (username, password, Sign In button)
- Divider line with "Or explore without signing in" text
- Amber/gold "Enter as Guest (View Only)" button with eye icon
- Small text below: "Demo mode - actions are disabled"

### Dashboard (Guest Mode Active)
- Amber banner at top: "Demo Mode - View Only" with "Sign in for full access" link
- "Guest" badge next to "PeerMesh Docker Lab" in header (amber colored)
- All action buttons greyed out (opacity 0.5)
- Clicking disabled buttons shows tooltip: "Login required for this action"

## API Dependencies

The frontend expects these backend API endpoints:

1. **GET `/api/config`** - Returns configuration including:
   ```json
   { "demo_mode_enabled": true }
   ```

2. **POST `/api/guest-login`** - Creates guest session, returns:
   - 200 OK on success (redirects to dashboard)
   - 4xx/5xx with `{ "error": "message" }` on failure

3. **GET `/api/session`** - Returns session info:
   ```json
   { "is_guest": true, "username": "guest", ... }
   ```

## Testing Notes

1. **To test guest button visibility:** Enable `DASHBOARD_DEMO_MODE=true` in environment
2. **To test guest mode UI:** Log in as guest via the button
3. **To test action disabling:** Verify action buttons show tooltip and don't execute

## Future Enhancements

- Add more granular action permissions (some actions might be allowed for guests)
- Add session timeout warning for guest sessions
- Consider adding read-only badge to individual cards/modules
