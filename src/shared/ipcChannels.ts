export const IPC_CHANNELS = {
  // Auth
  AUTH_GET_STATUS: 'auth:getStatus',
  AUTH_SIGN_IN: 'auth:signIn',
  AUTH_SIGN_OUT: 'auth:signOut',

  // Destination
  DEST_PICK_FOLDER: 'dest:pickFolder',
  DEST_VALIDATE: 'dest:validate',
  DEST_GET_CURRENT: 'dest:getCurrent',
  DEST_CLEAR: 'dest:clear',

  // Sync controls
  SYNC_START: 'sync:start',
  SYNC_PAUSE: 'sync:pause',
  SYNC_RESUME: 'sync:resume',
  SYNC_CANCEL: 'sync:cancel',
  SYNC_CONFIRM_MASS_MOVE: 'sync:confirmMassMove',
  SYNC_RETRY_FAILED: 'sync:retryFailed',
  SYNC_VERIFY_INTEGRITY: 'sync:verifyIntegrity',

  // Data queries
  DATA_GET_FAILED: 'data:getFailed',
  DATA_GET_RESTORED: 'data:getRestored',
  DATA_GET_HISTORY: 'data:getHistory',
  DATA_CLEAR_DB: 'data:clearDb',

  // Source folder
  SOURCE_GET: 'source:get',
  SOURCE_SET: 'source:set',
  SOURCE_LIST_FOLDERS: 'source:listFolders',

  // System
  SYSTEM_REVEAL_IN_FINDER: 'system:revealInFinder',
  SYSTEM_OPEN_LOGS: 'system:openLogs',
  SYSTEM_OPEN_AUTHOR_SITE: 'system:openAuthorSite',
  SYSTEM_OPEN_ABOUT: 'system:openAbout',

  // Events (Main -> Renderer)
  EVENT_SYNC_STATE: 'sync:state',
  EVENT_SYNC_PROGRESS: 'sync:progress',
  EVENT_SYNC_LOG: 'sync:log',
  EVENT_DRIVE_STATUS: 'drive:status',
} as const;
