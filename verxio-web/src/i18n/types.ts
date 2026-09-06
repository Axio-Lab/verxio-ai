// Desktop i18n type contract.
//
// `Translations` is the single source of truth for every translatable string
// surface. Fully translated locale files may satisfy this interface directly;
// partial locales should use `defineLocale()` so missing desktop-only strings
// fall back to English while new keys remain type-checked.

export type Locale = 'en' | 'zh' | 'zh-hant' | 'ja'

interface ModeOptionCopy {
  label: string
  description: string
}

interface AuxTaskCopy {
  label: string
  hint: string
}

export interface Translations {
  common: {
    apply: string
    back: string
    save: string
    saving: string
    cancel: string
    change: string
    choose: string
    clear: string
    close: string
    collapse: string
    confirm: string
    connect: string
    connecting: string
    continue: string
    copied: string
    copy: string
    copyFailed: string
    delete: string
    docs: string
    done: string
    error: string
    failed: string
    free: string
    loading: string
    notSet: string
    refresh: string
    remove: string
    replace: string
    retry: string
    run: string
    send: string
    set: string
    skip: string
    update: string
    on: string
    off: string
  }

  boot: {
    ready: string
    desktopBootFailedWithMessage: (message: string) => string
    steps: {
      connectingGateway: string
      loadingSettings: string
      loadingSessions: string
      startingDesktopConnection: string
      startingHermesDesktop: string
    }
    errors: {
      backgroundExited: string
      backgroundExitedDuringStartup: string
      backendStopped: string
      desktopBootFailed: string
      gatewaySignInRequired: string
      ipcBridgeUnavailable: string
    }
    failure: {
      title: string
      description: string
      remoteTitle: string
      remoteDescription: string
      retry: string
      repairInstall: string
      useLocalGateway: string
      openLogs: string
      repairHint: string
      remoteSignInHint: string
      hideRecentLogs: string
      showRecentLogs: string
      signedInTitle: string
      signedInMessage: string
      signInIncompleteTitle: string
      signInIncompleteMessage: string
      signInFailed: string
      signInToRemoteGateway: string
      signInWithProvider: (provider: string) => string
      identityProvider: string
      hostedTitle: string
      hostedDescription: string
      hostedHint: string
    }
  }

  notifications: {
    region: string
    hide: string
    show: string
    more: (count: number) => string
    clearAll: string
    dismiss: string
    details: string
    copyDetail: string
    copyDetailFailed: string
    backendOutOfDateTitle: string
    backendOutOfDateMessage: string
    updateHermes: string
    updateReadyTitle: string
    updateReadyMessage: (count: number) => string
    seeWhatsNew: string
    errors: {
      elevenLabsNeedsKey: string
      elevenLabsRejectedKey: string
      methodNotAllowed: string
      microphonePermission: string
      openaiRejectedApiKey: string
      openaiRejectedApiKeyWithStatus: (status: string) => string
      openaiTtsNeedsKey: string
    }
    voice: {
      configureSpeechToText: string
      couldNotStartSession: string
      microphoneAccessDenied: string
      microphoneConstraintsUnsupported: string
      microphoneFailed: string
      microphoneInUse: string
      microphonePermissionDenied: string
      microphoneStartFailed: string
      microphoneUnsupported: string
      noMicrophone: string
      noSpeechDetected: string
      playbackFailed: string
      recordingFailed: string
      transcriptionFailed: string
      transcriptionUnavailable: string
      tryRecordingAgain: string
      unavailable: string
    }
    native: {
      approvalTitle: string
      approveAction: string
      rejectAction: string
      inputTitle: string
      inputBody: string
      turnDoneTitle: string
      turnDoneBody: string
      turnErrorTitle: string
      backgroundDoneTitle: string
      backgroundFailedTitle: string
    }
  }

  remoteDisplayBanner: {
    message: (reason: string) => string
    dismiss: string
  }

  titlebar: {
    hideSidebar: string
    showSidebar: string
    search: string
    searchTitle: string
    swapSidebarSides: string
    swapSidebarSidesTitle: string
    hideRightSidebar: string
    showRightSidebar: string
    muteHaptics: string
    unmuteHaptics: string
    openSettings: string
    openKeybinds: string
    signOut: string
  }

  keybinds: {
    title: string
    subtitle: (open: string) => string
    rebind: string
    reset: string
    resetAll: string
    pressKey: string
    set: string
    conflictWith: (label: string) => string
    categories: Record<string, string>
    actions: Record<string, string>
  }

  language: {
    label: string
    description: string
    saving: string
    saveError: string
    switchTo: string
    searchPlaceholder: string
    noResults: string
  }

  settings: {
    closeSettings: string
    exportConfig: string
    importConfig: string
    resetToDefaults: string
    resetConfirm: string
    exportFailed: string
    resetFailed: string
    nav: {
      providers: string
      providerAccounts: string
      providerApiKeys: string
      apiKeys: string
      keysTools: string
      keysTranscription: string
      keysSettings: string
      mcp: string
      archivedChats: string
      about: string
      notifications: string
    }
    runtime: {
      reloadDoneTitle: string
      reloadDoneMessage: string
      reloadFailed: string
      agentRestartDoneTitle: string
      agentRestartDoneMessage: string
      agentRestartFailed: string
      containerRestartDoneTitle: string
      containerRestartDoneMessage: string
      containerRestartFailed: string
      restartTimeout: string
    }
    notifications: {
      title: string
      intro: string
      enableAll: string
      enableAllDesc: string
      focusedHint: string
      kinds: Record<
        'approval' | 'backgroundDone' | 'input' | 'turnDone' | 'turnError',
        { label: string; description: string }
      >
      test: string
      testTitle: string
      testBody: string
      testSent: string
      testUnsupported: string
      completionSoundTitle: string
      completionSoundDesc: string
      completionSoundPreview: string
    }
    sections: Record<string, string>
    searchPlaceholder: Record<'about' | 'config' | 'keys' | 'mcp' | 'sessions', string>
    modeOptions: Record<'light' | 'dark' | 'system', ModeOptionCopy>
    appearance: {
      title: string
      intro: string
      colorMode: string
      colorModeDesc: string
      translucencyTitle: string
      translucencyDesc: string
      toolViewTitle: string
      toolViewDesc: string
      product: string
      productDesc: string
      technical: string
      technicalDesc: string
      themeTitle: string
      themeDesc: string
    }
    fieldLabels: Record<string, string>
    fieldDescriptions: Record<string, string>
    about: {
      heading: string
      description: string
    }
    config: {
      none: string
      noneParen: string
      notSet: string
      commaSeparated: string
      loading: string
      emptyTitle: string
      emptyDesc: string
      failedLoad: string
      autosaveFailed: string
      imported: string
      invalidJson: string
    }
    credentials: {
      pasteKey: string
      pasteLabelKey: (label: string) => string
      optional: string
      enterValueFirst: string
      couldNotSave: string
      customToolDescription: string
      remove: string
      or: string
      escToCancel: string
      getKey: string
      saving: string
      removing: string
    }
    envActions: {
      actionsFor: (label: string) => string
      credentialActions: string
      docs: string
      hideValue: string
      revealValue: string
      replace: string
      set: string
      clear: string
    }
    keys: {
      loading: string
      failedLoad: string
      empty: string
      custom: {
        addButton: string
        hint: string
        namePlaceholder: string
        valuePlaceholder: string
        nameRequired: string
        invalidName: string
        alreadyListed: string
        valueRequired: string
        saveFailed: string
        save: string
      }
    }
    mcp: {
      loading: string
      failedLoad: string
      nameRequiredTitle: string
      nameRequiredMessage: string
      objectRequired: string
      invalidJson: string
      saveFailed: string
      removeFailed: string
      gatewayUnavailableTitle: string
      gatewayUnavailableMessage: string
      reloadedTitle: string
      reloadedMessage: string
      reloadFailed: string
      savedTitle: string
      savedMessage: (name: string) => string
      newServer: string
      reload: string
      reloading: string
      emptyTitle: string
      emptyDesc: string
      disabled: string
      editServer: string
      name: string
      serverJson: string
      remove: string
      saveServer: string
    }
    model: {
      loading: string
      provider: string
      model: string
      applying: string
      auxiliaryTitle: string
      resetAllToMain: string
      auxiliaryDesc: string
      setToMain: string
      change: string
      autoUseMain: string
      providerDefault: string
      tasks: Record<string, AuxTaskCopy>
    }
    providers: {
      connectAccount: string
      connectAccountFeaturedPitch: string
      haveApiKey: string
      intro: string
      connected: string
      collapse: string
      connectAnother: string
      otherProviders: string
      noProviderKeys: string
      loading: string
      switching: string
      accountLabel: string
      disconnect: string
      reconnect: string
      removeConfirm: (provider: string) => string
      removeExternalGeneric: (provider: string) => string
      removedTitle: string
      removedMessage: (provider: string) => string
      failedRemove: (provider: string) => string
    }
    sessions: {
      loading: string
      archivedTitle: string
      archivedIntro: string
      emptyArchivedTitle: string
      emptyArchivedDesc: string
      unarchive: string
      deletePermanently: string
      messages: (count: number) => string
      restored: string
      deleteConfirm: (title: string) => string
      defaultDirTitle: string
      defaultDirDesc: string
      defaultDirUpdated: string
      defaultsTo: (label: string) => string
      change: string
      choose: string
      clear: string
      notSet: string
      failedLoad: string
      unarchiveFailed: string
      deleteFailed: string
      updateDirFailed: string
      clearDirFailed: string
    }
    toolsets: {
      loadingConfig: string
      savedTitle: string
      savedMessage: (key: string) => string
      removedTitle: string
      removedMessage: (key: string) => string
      failedSave: (key: string) => string
      failedRemove: (key: string) => string
      failedReveal: (key: string) => string
      removeConfirm: (key: string) => string
      set: string
      notSet: string
      selectedTitle: string
      selectedMessage: (provider: string) => string
      failedSelect: (provider: string) => string
      failedLoad: string
      noProviderOptions: string
      noProviders: string
      ready: string
      active: string
      useProvider: string
      usingProvider: (provider: string, model?: string | null) => string
      usingProviderHint: string
      nousIncluded: string
      noApiKeyRequired: string
      postSetup: (step: string) => string
      modelSectionTitle: string
      modelSectionHint: string
      modelSavedTitle: string
      modelSavedMessage: (model: string) => string
      failedModelSave: string
    }
  }

  skills: {
    tabSkills: string
    tabToolsets: string
    webSearchTitle: string
    webSearchDescription: string
    all: string
    searchSkills: string
    searchToolsets: string
    searchConnections: string
    refresh: string
    refreshing: string
    loading: string
    noSkillsTitle: string
    noSkillsDesc: string
    noToolsetsTitle: string
    noToolsetsDesc: string
    noDescription: string
    configured: string
    needsKeys: string
    toolsetsEnabled: (enabled: number, total: number) => string
    configureToolset: (label: string) => string
    toggleToolset: (label: string) => string
    skillsLoadFailed: string
    toolsetsRefreshFailed: string
    skillEnabled: string
    skillDisabled: string
    toolsetEnabled: string
    toolsetDisabled: string
    appliesToNewSessions: (name: string) => string
    failedToUpdate: (name: string) => string
    newSkill: string
    editSkill: (name: string) => string
    editor: {
      createTitle: string
      editTitle: (name: string) => string
      createDesc: string
      editDesc: string
      nameLabel: string
      categoryLabel: string
      contentLabel: string
      nameRequired: string
      contentRequired: string
      saving: string
      saveChanges: string
      createSkill: string
      deleteSkill: string
      deleteTitle: (name: string) => string
      deleteDesc: (name: string) => string
      deleteConfirm: string
      deleting: string
      deleted: string
      importPackage: string
      importing: string
      importHint: string
      importReady: string
      importSupportFiles: (count: number) => string
      importSkippedBinary: (count: number) => string
    }
  }

  agents: {
    close: string
    title: string
    subtitle: string
    emptyTitle: string
    emptyDesc: string
    running: string
    failed: string
    done: string
    streaming: string
    files: string
    moreFiles: (count: number) => string
    delegation: (index: number) => string
    workers: (count: number) => string
    workersActive: (count: number) => string
    agentsCount: (count: number) => string
    activeCount: (count: number) => string
    failedCount: (count: number) => string
    toolsCount: (count: number) => string
    filesCount: (count: number) => string
    updatedAgo: (age: string) => string
    ageNow: string
    ageSeconds: (seconds: number) => string
    ageMinutes: (minutes: number) => string
    ageHours: (hours: number) => string
    durationSeconds: (seconds: string) => string
    durationMinutes: (minutes: number, seconds: number) => string
    tokensK: (k: string) => string
    tokens: (value: number) => string
  }

  commandCenter: {
    close: string
    paletteTitle: string
    back: string
    searchPlaceholder: string
    goTo: string
    commandCenter: string
    appearance: string
    settings: string
    changeTheme: string
    changeColorMode: string
    settingsFields: string
    mcpServers: string
    archivedChats: string
    sections: Record<'sessions' | 'usage', string>
    sectionDescriptions: Record<'sessions' | 'usage', string>
    nav: Record<'newChat' | 'settings' | 'skills' | 'messaging' | 'artifacts', { title: string; detail: string }>
    sectionEntries: Record<'sessions' | 'usage', { title: string; detail: string }>
    providerNavigate: string
    providerSessions: string
    refresh: string
    refreshing: string
    noResults: string
    pinSession: string
    unpinSession: string
    exportSession: string
    deleteSession: string
    noSessions: string
    gatewayRunning: string
    gatewayStopped: string
    hermesActiveSessions: (version: string, count: number) => string
    restartMessaging: string
    restartGateway: string
    reloadRuntimeEnv: string
    restartAgentRuntime: string
    restartVerxioRuntime: string
    gatewayRestartFailed: string
    updateHermes: string
    actionRunning: string
    actionDone: string
    actionFailed: string
    actionStartedWaiting: string
    loadingStatus: string
    recentLogs: string
    noLogs: string
    days: (count: number) => string
    statSessions: string
    statApiCalls: string
    statTokens: string
    statCost: string
    actualCost: (cost: string) => string
    loadingUsage: string
    noUsage: (period: number) => string
    retry: string
    dailyTokens: string
    input: string
    output: string
    noDailyActivity: string
    topModels: string
    noModelUsage: string
    topSkills: string
    noSkillActivity: string
    actions: (count: string) => string
  }

  messaging: {
    search: string
    loading: string
    loadFailed: string
    states: Record<string, string>
    unknown: string
    hintPendingRestart: string
    hintGatewayStopped: string
    credentialsSet: string
    needsSetup: string
    gatewayStopped: string
    getCredentials: string
    openSetupGuide: string
    required: string
    recommended: string
    advanced: (count: number) => string
    noTokenNeeded: string
    enabled: string
    disabled: string
    unsavedChanges: string
    saving: string
    saveChanges: string
    saved: string
    replaceValue: string
    openDocs: string
    clearField: (key: string) => string
    enableAria: (name: string) => string
    disableAria: (name: string) => string
    platformEnabled: (name: string) => string
    platformDisabled: (name: string) => string
    restartToApply: string
    gatewayRestarting: string
    setupSaved: (name: string) => string
    restartToReconnect: string
    keyCleared: (key: string) => string
    setupUpdated: (name: string) => string
    failedUpdate: (name: string) => string
    failedSave: (name: string) => string
    failedClear: (key: string) => string
    fieldCopy: Record<string, { label?: string; help?: string; placeholder?: string }>
    whatsappCloudIntro: {
      title: string
      description: string
      steps: string[]
    }
    whatsappCloudSettings: {
      title: string
      description: string
      webhookHint: string
      homeChannelHint: string
      groupsHint: string
      sections: {
        credentials: string
        webhook: string
        access: string
        delivery: string
        groups: string
      }
    }
    whatsappSettings: {
      title: string
      description: string
      homeChannelHint: string
      groupsHint: string
      sections: {
        bridge: string
        access: string
        delivery: string
        groups: string
        advanced: string
      }
    }
    slackManifest: {
      title: string
      description: string
      steps: string[]
      generate: string
      generating: string
      openSlackApps: string
      manifestLabel: string
      copy: string
      copied: string
      generateFailed: string
      copyFailed: string
    }
    pairingRequests: {
      title: string
      description: (platform: string) => string
      refresh: string
      retry: string
      loadRetryHelp: string
      codeLabel: string
      codePlaceholder: (platform: string) => string
      codeRequired: string
      approve: string
      approving: string
      pendingTitle: (count: number) => string
      approvedTitle: (count: number) => string
      emptyPending: string
      emptyApproved: string
      pendingMeta: (code: string, age: number) => string
      approvedMeta: (approvedAt: string) => string
      revoke: string
      revokeAria: (user: string) => string
      loadFailed: string
      approveFailed: string
      revokeFailed: string
      approvedToastTitle: string
      approvedToastMessage: (user: string, platform: string) => string
      revokedToastTitle: string
      revokedToastMessage: (user: string, platform: string) => string
    }
    whatsappPairing: {
      title: string
      description: string
      showQr: string
      starting: string
      waitingForQr: string
      scanInstructions: string
      qrAlt: string
      cancel: string
      pairedTitle: string
      pairedMessage: string
      connectedTitle: string
      restartingGateway: string
      restartManually: string
      finishSetup: string
      connecting: string
      allowedUsersLabel: string
      allowedUsersHelp: string
      allowedUsersPlaceholder: string
      alreadyPaired: string
      repair: string
      startFailed: string
      applyFailed: string
      scanFirst: string
      disconnect: string
      disconnecting: string
      disconnectConfirm: string
      disconnectedTitle: string
      disconnectedMessage: string
      disconnectFailed: string
      messageYourselfHelp: string
    }
    webhooks: {
      title: string
      description: string
      enableHint: string
      listenerOn: string
      listenerOff: string
      enabledTitle: string
      enabledMessage: string
      enableFailed: string
      loadFailed: string
      routesTitle: string
      loadingRoutes: string
      emptyRoutes: string
      createTitle: string
      createHint: string
      needConnectedChannel: string
      nameLabel: string
      namePlaceholder: string
      nameRequired: string
      eventsLabel: string
      eventsPlaceholder: string
      promptLabel: string
      promptPlaceholder: string
      deliverLabel: string
      deliverPlaceholder: string
      deliverRequired: string
      noConnection: string
      noHomeChannel: string
      setHomeChannel: (platform: string) => string
      connectFirst: (platform: string) => string
      createAction: string
      creating: string
      createdTitle: string
      createdMessage: (name: string) => string
      createFailed: string
      secretOnceTitle: string
      secretOnceHint: string
      urlLabel: string
      secretLabel: string
      copiedTitle: (label: string) => string
      copiedMessage: string
      copyFailed: string
      copyUrl: string
      deleteRoute: string
      deletedTitle: string
      deletedMessage: (name: string) => string
      deleteFailed: string
      updateFailed: string
      deliversTo: (channel: string) => string
      publicUrlHint: string
      scopedEmptyRoutes: string
      scopedCreateHint: string
    }
    apiServer: {
      title: string
      description: string
      keyHint: string
      baseUrlLabel: string
      copyUrl: string
      copiedTitle: (label: string) => string
      copiedMessage: string
      copyFailed: string
      authHint: string
      loadFailed: string
      connectionHint: string
    }
    platformIntro: Record<string, string>
  }

  profiles: {
    close: string
    nameHint: string
    title: string
    count: (count: number) => string
    loading: string
    newProfile: string
    allProfiles: string
    showAllProfiles: string
    switchToProfile: (name: string) => string
    manageProfiles: string
    actionsFor: (name: string) => string
    color: string
    colorFor: (name: string) => string
    setColor: (color: string) => string
    autoColor: string
    noProfiles: string
    selectPrompt: string
    refresh: string
    refreshing: string
    default: string
    skills: (count: number) => string
    env: string
    defaultBadge: string
    rename: string
    copySetup: string
    copying: string
    modelLabel: string
    skillsLabel: string
    notSet: string
    soulDesc: string
    soulOptional: string
    soulPlaceholder: (mode: string) => string
    soulPlaceholderCloned: string
    soulPlaceholderEmpty: string
    unsavedChanges: string
    loadingSoul: string
    emptySoul: string
    saving: string
    saveSoul: string
    deleteTitle: string
    deleteDescPrefix: string
    deleteDescMid: string
    deleteDescSuffix: string
    deleting: string
    createDesc: string
    nameLabel: string
    cloneFromDefault: string
    cloneFromDefaultDesc: string
    invalidName: (hint: string) => string
    nameRequired: string
    creating: string
    createAction: string
    renameTitle: string
    renameDescPrefix: string
    renameDescSuffix: string
    newNameLabel: string
    renaming: string
    created: string
    renamed: string
    deleted: string
    setupCopied: string
    soulSaved: string
    failedLoad: string
    failedDelete: string
    failedCopy: string
    failedLoadSoul: string
    failedSaveSoul: string
    failedCreate: string
    failedRename: string
  }

  cron: {
    close: string
    search: string
    refresh: string
    refreshing: string
    loading: string
    states: Record<string, string>
    deliveryLabels: Record<string, string>
    scheduleLabels: Record<string, string>
    scheduleHints: Record<string, string>
    days: Record<string, string>
    dayFallback: (value: string) => string
    everyDayAt: (time: string) => string
    weekdaysAt: (time: string) => string
    everyDayOfWeekAt: (day: string, time: string) => string
    monthlyOnDayAt: (dayOfMonth: string, time: string) => string
    topOfHour: string
    everyHourAt: (minute: string) => string
    active: (enabled: number, total: number) => string
    newCron: string
    createFirst: string
    emptyDescNew: string
    emptyDescSearch: string
    emptyTitleNew: string
    emptyTitleSearch: string
    last: string
    next: string
    noRuns: string
    manage: string
    showRuns: string
    hideRuns: string
    actionsFor: (title: string) => string
    actionsTitle: string
    resume: string
    pause: string
    resumeTitle: string
    pauseTitle: string
    triggerNow: string
    edit: string
    deleteTitle: string
    deleteDescPrefix: string
    deleteDescSuffix: string
    deleting: string
    resumed: string
    paused: string
    triggered: string
    deleted: string
    created: string
    updated: string
    failedLoad: string
    failedUpdate: string
    failedTrigger: string
    failedDelete: string
    failedSave: string
    editTitle: string
    createTitle: string
    editDesc: string
    createDesc: string
    nameLabel: string
    namePlaceholder: string
    promptLabel: string
    promptPlaceholder: string
    frequencyLabel: string
    deliverLabel: string
    customScheduleLabel: string
    customPlaceholder: string
    customHint: string
    optional: string
    promptScheduleRequired: string
    deliverRequired: string
    saveChanges: string
    createAction: string
  }

  artifacts: {
    search: string
    refresh: string
    refreshing: string
    indexing: string
    tabAll: string
    tabImages: string
    tabFiles: string
    tabLinks: string
    noArtifactsTitle: string
    noArtifactsDesc: string
    failedLoad: string
    openFailed: string
    deleteAction: string
    deleteTitle: (label: string) => string
    deleteDescription: string
    deleteConfirm: string
    deleting: string
    deleted: string
    selectAll: string
    selectHint: string
    selectItem: (label: string) => string
    selectedCount: (count: number) => string
    deleteSelected: (count: number) => string
    batchDeleteTitle: (count: number) => string
    batchDeleteDescription: (count: number) => string
    batchDeleted: (count: number) => string
    batchDeleteFailed: string
    batchDeletePartial: (deleted: number, failed: number) => string
    previewDescription: string
    downloadAction: string
    downloadStarted: string
    downloadFailed: string
    itemsImage: string
    itemsLink: string
    itemsFile: string
    itemsGeneric: string
    zero: string
    rangeOf: (start: number, end: number, total: number) => string
    goToPage: (itemLabel: string, page: number) => string
    colTitleLink: string
    colTitleFile: string
    colTitleDefault: string
    colLocationLink: string
    colLocationFile: string
    colLocationDefault: string
    colSession: string
    kindImage: string
    kindFile: string
    kindLink: string
    chat: string
    copyUrl: string
    copyPath: string
  }

  sidebar: {
    nav: Record<string, string>
    searchAria: string
    searchPlaceholder: string
    clearSearch: string
    noMatch: (query: string) => string
    results: string
    pinned: string
    sessions: string
    cronJobs: string
    groupAriaGrouped: string
    groupAriaUngrouped: string
    groupTitleGrouped: string
    groupTitleUngrouped: string
    allPinned: string
    noSessions: string
    shiftClickHint: string
    noWorkspace: string
    newSessionIn: (label: string) => string
    reorderWorkspace: (label: string) => string
    showMoreIn: (count: number, label: string) => string
    loading: string
    loadMore: string
    loadCount: (step: number) => string
    row: {
      pin: string
      unpin: string
      copyId: string
      export: string
      rename: string
      archive: string
      copyIdFailed: string
      actionsFor: (title: string) => string
      sessionActions: string
      sessionRunning: string
      needsInput: string
      waitingForAnswer: string
      renamed: string
      renameFailed: string
      renameTitle: string
      renameDesc: string
      untitledPlaceholder: string
      ageNow: string
      ageDay: string
      ageHour: string
      ageMin: string
    }
  }

  composer: {
    message: string
    wakingProfile: (profile: string) => string
    placeholderStarting: string
    placeholderReconnecting: string
    placeholderFollowUp: string
    newSessionPlaceholders: readonly string[]
    followUpPlaceholders: readonly string[]
    startVoice: string
    queueMessage: string
    steer: string
    stop: string
    send: string
    speaking: string
    transcribing: string
    thinking: string
    muted: string
    listening: string
    muteMic: string
    unmuteMic: string
    stopListening: string
    stopShort: string
    endConversation: string
    endShort: string
    stopDictation: string
    transcribingDictation: string
    voiceDictation: string
    lookupLoading: string
    lookupNoMatches: string
    lookupTry: string
    lookupOr: string
    commonCommands: string
    hotkeys: string
    helpFooter: string
    commandDescs: Record<string, string>
    hotkeyDescs: Record<string, string>
    attachUrlTitle: string
    attachUrlDesc: string
    urlPlaceholder: string
    urlHintPre: string
    attach: string
    queued: (count: number) => string
    attachmentOnly: string
    emptyTurn: string
    attachments: (count: number) => string
    editingInComposer: string
    editingQueuedInComposer: string
    editQueued: string
    sendQueuedNext: string
    sendQueuedNow: string
    deleteQueued: string
    queueEdit: string
    queueSendNext: string
    queueSend: string
    queueDelete: string
    queueShowFull: string
    queueShowLess: string
    previewUnavailable: string
    previewLabel: (label: string) => string
    couldNotPreview: (label: string) => string
    removeAttachment: (label: string) => string
    dictating: string
    preparingAudio: string
    speakingResponse: string
    readingAloud: string
    themeSuggestions: string
    noMatchingThemes: string
    themeTryPre: string
    themeTryPost: string
    attachLabel: string
    audio: string
    audioAttachFailed: string
    audioNeedsUpload: string
    files: string
    folder: string
    images: string
    pasteImage: string
    url: string
    promptSnippets: string
    tipPre: string
    tipPost: string
    snippetsTitle: string
    snippetsDesc: string
    snippets: Record<string, { label: string; description: string; text: string }>
    dropFiles: string
    dropSession: string
  }

  statusStack: {
    agents: string
    background: (count: number) => string
    subagents: (count: number) => string
    todos: (done: number, total: number) => string
    running: string
    stop: string
    dismiss: string
    exit: (code: number) => string
  }

  updates: {
    stages: Record<string, string>
    checking: string
    checkFailedTitle: string
    tryAgain: string
    notAvailableTitle: string
    unsupportedMessage: string
    connectionRetry: string
    latestBody: string
    allSetTitle: string
    availableTitle: string
    availableBody: string
    updateNow: string
    maybeLater: string
    moreChanges: (count: number) => string
    manualTitle: string
    manualBody: string
    manualPickedUp: string
    copy: string
    copied: string
    done: string
    applyingBody: string
    applyingClose: string
    errorTitle: string
    errorBody: string
    notNow: string
  }

  install: {
    stageStates: Record<string, string>
    oneTimeTitle: string
    unsupportedDesc: (platform: string) => string
    installCommand: string
    copyCommand: string
    viewDocs: string
    installTo: string
    retryAfterRun: string
    failedTitle: string
    settingUpTitle: string
    finishingTitle: string
    failedDesc: string
    activeDesc: string
    progress: (completed: number, total: number) => string
    currentStage: (stage: string) => string
    fetchingManifest: string
    error: string
    hideOutput: string
    showOutput: string
    lines: (count: number) => string
    noOutput: string
    cancelling: string
    cancelInstall: string
    transcriptSaved: string
    copiedOutput: string
    copyOutput: string
    reloadRetry: string
  }

  onboarding: {
    headerTitle: string
    headerDesc: string
    preparingInstall: string
    starting: string
    lookingUpProviders: string
    collapse: string
    otherProviders: string
    haveApiKey: string
    chooseLater: string
    recommended: string
    connected: string
    featuredPitch: string
    openRouterPitch: string
    apiKeyOptions: Record<string, { short: string; description: string }>
    backToSignIn: string
    getKey: string
    replaceCurrent: string
    pasteApiKey: string
    localApiKeyPlaceholder: string
    couldNotSave: string
    connecting: string
    update: string
    flowSubtitles: Record<string, string>
    startingSignIn: (provider: string) => string
    verifyingCode: (provider: string) => string
    connectedProvider: (provider: string) => string
    connectedPicking: (provider: string) => string
    signInFailed: string
    pickDifferentProvider: string
    signInWith: (provider: string) => string
    openedBrowser: (provider: string) => string
    authorizeThere: string
    copyAuthCode: string
    copyCallbackUrl: string
    pasteAuthCode: string
    pasteCallbackUrl: string
    reopenAuthPage: string
    autoBrowser: (provider: string) => string
    reopenSignInPage: string
    waitingAuthorize: string
    externalPending: (provider: string) => string
    signedIn: string
    deviceCodeOpened: (provider: string) => string
    reopenVerification: string
    copy: string
    defaultModel: string
    freeTier: string
    pro: string
    free: string
    price: (input: string, output: string) => string
    change: string
    startChatting: string
    docs: (provider: string) => string
  }

  modelPicker: {
    title: string
    current: string
    unknown: string
    search: string
    noModels: string
    persistGlobalSession: string
    persistGlobal: string
    addProvider: string
    loadFailed: string
    noAuthenticatedProviders: string
    pro: string
    proNeedsSubscription: string
    free: string
    freeTier: string
    priceTitle: string
  }

  modelVisibility: {
    title: string
    search: string
    noAuthenticatedProviders: string
    addProvider: string
  }

  shell: {
    windowControls: string
    paneControls: string
    appControls: string
    modelMenu: {
      search: string
      noModels: string
      editModels: string
      fast: string
      medium: string
    }
    modelOptions: {
      noOptions: string
      options: string
      thinking: string
      fast: string
      effort: string
      minimal: string
      low: string
      medium: string
      high: string
      max: string
      updateFailed: string
      fastFailed: string
    }
    gatewayMenu: {
      gateway: string
      connected: string
      connecting: string
      offline: string
      inferenceReady: string
      inferenceNotReady: string
      checkingInference: string
      disconnected: string
      openSystem: string
      connection: (label: string) => string
      recentActivity: string
      viewAllLogs: string
      messagingPlatforms: string
    }
    statusbar: {
      closeCommandCenter: string
      openCommandCenter: string
      status: string
      statusConnected: string
      statusConnecting: string
      statusDisconnected: string
      gateway: string
      gatewayReady: string
      gatewayNeedsSetup: string
      gatewayChecking: string
      gatewayConnecting: string
      gatewayOffline: string
      gatewayTitle: string
      gatewayRestarting: string
      agents: string
      closeAgents: string
      openAgents: string
      subagents: (count: number) => string
      failed: (count: number) => string
      running: (count: number) => string
      cron: string
      openCron: string
      turnRunning: string
      currentTurnElapsed: string
      contextUsage: string
      session: string
      runtimeSessionElapsed: string
      yoloOn: string
      yoloOff: string
      modelNone: string
      noModel: string
      switchModel: string
      openModelPicker: string
      modelTitle: (provider: string, model: string) => string
      providerModelTitle: (provider: string, model: string) => string
    }
  }

  folderAccess: {
    title: string
    body: string
    allow: string
    cancel: string
    unsupportedTitle: string
    unsupportedBody: string
    dismiss: string
  }

  rightSidebar: {
    aria: string
    panelsAria: string
    files: string
    terminal: string
    noFolderSelected: string
    changeCwdTitle: string
    folderTip: (cwd: string) => string
    openFolder: string
    refreshTree: string
    collapseAll: string
    previewUnavailable: string
    couldNotPreview: (path: string) => string
    noProjectTitle: string
    noProjectBody: string
    unreadableTitle: string
    unreadableBody: (error: string) => string
    emptyTitle: string
    emptyBody: string
    treeErrorTitle: string
    treeErrorBody: string
    tryAgain: string
    loadingTree: string
    loadingFiles: string
    terminalFocus: string
    terminalSplit: string
    addToChat: string
    folderPickerTitle: string
    folderPickerDescription: string
    folderPickerSelect: string
    folderPickerChooseAnother: string
  }

  preview: {
    tab: string
    closeTab: (label: string) => string
    closePane: string
    loading: string
    unavailable: string
    opening: string
    hide: string
    openPreview: string
    openInBrowser: string
    sourceLineTitle: string
    source: string
    renderedPreview: string
    unknownSize: string
    binaryTitle: string
    binaryBody: (label: string) => string
    largeTitle: string
    largeBody: (label: string, size: string) => string
    previewAnyway: string
    truncated: string
    noInlineTitle: string
    noInlineBody: (mimeType: string) => string
    console: {
      deselect: string
      select: string
      copyFailed: string
      copyEntry: string
      sendEntry: string
      messages: (count: number) => string
      resize: string
      title: string
      selected: (count: number) => string
      sendToChat: string
      copySelected: string
      copyAll: string
      copy: string
      clear: string
      empty: string
      promptHeader: string
      sentTitle: string
      sentMessage: (count: number) => string
    }
    web: {
      appFailedToBoot: string
      serverNotFound: string
      failedToLoad: string
      tryAgain: string
      restarting: string
      askRestart: string
      lookingRestart: (taskId: string) => string
      restartingTitle: string
      restartingMessage: string
      startRestartFailed: (message: string) => string
      restartFailed: string
      hideConsole: string
      showConsole: string
      hideDevTools: string
      openDevTools: string
      finishedRestarting: (message?: string) => string
      failedRestarting: (message: string) => string
      unknownError: string
      restartedTitle: string
      reloadingNow: string
      restartFailedTitle: string
      restartFailedMessage: string
      stillWorking: string
      workspaceReloading: string
      fileChanged: (url: string) => string
      filesChanged: (count: number, url: string) => string
      watchFailed: (message: string) => string
      moduleMimeDescription: string
      loadFailedConsole: (code: number | undefined, message: string) => string
      unreachableDescription: string
      openTarget: (url: string) => string
      fallbackTitle: string
    }
  }

  assistant: {
    thread: {
      loadingSession: string
      loadingResponse: string
      summarizing: string
      thinking: string
      today: (time: string) => string
      yesterday: (time: string) => string
      copy: string
      refresh: string
      moreActions: string
      branchNewChat: string
      readAloudFailed: string
      preparingAudio: string
      stopReading: string
      readAloud: string
      editMessage: string
      stop: string
      editableCheckpoint: string
      restoreFromHere: string
      restoreTitle: string
      restoreBody: string
      restoreConfirm: string
      restorePrevious: string
      restoreCheckpoint: string
      restoreNext: string
      goForward: string
      sendEdited: string
      processNotificationOutput: string
      scrollToBottom: string
    }
    approval: {
      gatewayDisconnected: string
      sendFailed: string
      run: string
      moreOptions: string
      allowSession: string
      alwaysAllowMenu: string
      reject: string
      alwaysTitle: string
      alwaysDescription: (pattern: string) => string
      alwaysAllow: string
      jumpToApproval: string
    }
    clarify: {
      notReady: string
      gatewayDisconnected: string
      sendFailed: string
      loadingQuestion: string
      other: string
      placeholder: string
      shortcut: string
      back: string
      skip: string
      send: string
    }
    tool: {
      code: string
      copyCode: string
      renderingImage: string
      copyOutput: string
      copyCommand: string
      copyContent: string
      copyUrl: string
      copyResults: string
      copyQuery: string
      copyFile: string
      copyPath: string
      outputAlt: string
      rawResponse: string
      searchResults: string
      copyActivity: string
      recoveredOne: string
      recoveredMany: (count: number) => string
      failedOne: string
      failedMany: (count: number) => string
      statusRunning: string
      statusError: string
      statusRecovered: string
      statusDone: string
    }
  }

  prompts: {
    gatewayDisconnected: string
    sudoSendFailed: string
    secretSendFailed: string
    sudoTitle: string
    sudoDesc: string
    sudoPlaceholder: string
    secretTitle: string
    secretDesc: string
    secretPlaceholder: string
    fishAudioTitle: string
    fishAudioDescription: string
    fishAudioAction: string
    fishAudioExpires: string
    fishAudioWorking: string
    fishAudioConfirmationFailed: string
  }

  desktop: {
    audioReadFailed: string
    audioAttachmentExpired: string
    useAttachedAudio: string
    sessionUnavailable: string
    createSessionFailed: string
    promptFailed: string
    providerCredentialRequired: string
    noModelSelected: string
    emptySlashCommand: string
    desktopCommands: string
    skillCommandsAvailable: (count: number) => string
    warningLine: (message: string) => string
    yoloArmed: string
    yoloOff: string
    yoloSystem: (active: boolean) => string
    yoloTitle: string
    yoloToggleFailed: string
    profileStatus: (current: string) => string
    unknownProfile: string
    noProfileNamed: (target: string, available: string) => string
    newChatsProfile: (name: string) => string
    setProfileFailed: string
    sttDisabled: string
    stopFailed: string
    regenerateFailed: string
    editFailed: string
    resumeFailed: string
    nothingToBranch: string
    branchNeedsChat: string
    sessionBusy: string
    branchStopCurrent: string
    branchNoText: string
    branchTitle: string
    branchFailed: string
    deleteFailed: string
    archived: string
    archiveFailed: string
    cwdChangeFailed: string
    cwdStagedTitle: string
    cwdStagedMessage: string
    modelSwitchFailed: string
    sessionExported: string
    sessionExportFailed: string
    imageSaved: string
    downloadStarted: string
    restartToUseSaveImage: string
    restartToSaveImages: string
    imageDownloadFailed: string
    openImage: string
    downloadImage: string
    savingImage: string
    imagePreviewFailed: string
    imageAttach: string
    imageWriteFailed: string
    imageAttachFailed: string
    attachImages: string
    clipboard: string
    noClipboardImage: string
    clipboardPasteFailed: string
    dropFiles: string
  }

  errors: {
    genericFailure: string
    boundaryTitle: string
    boundaryDesc: string
    reloadWindow: string
    openLogs: string
  }

  ui: {
    search: {
      clear: string
    }
    pagination: {
      label: string
      previous: string
      previousAria: string
      next: string
      nextAria: string
    }
    sidebar: {
      title: string
      description: string
      toggle: string
    }
  }
}
