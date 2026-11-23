export default defineNuxtConfig({
  compatibilityDate: '2025-07-01',
  devtools: { enabled: false },

  modules: [
    '@nuxtjs/tailwindcss',
    '@nuxt/eslint',
  ],

  typescript: {
    strict: true,
    typeCheck: false,
  },

  app: {
    head: {
      title: 'MiraiStudy — 資格試験・技術習得＆3シナリオ未来予測AIエージェント',
      htmlAttrs: {
        lang: 'ja',
      },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content: '資格試験・プログラミング学習記録、3シナリオ未来予測、エビングハウス忘却曲線復習キューを行うAIエージェントアプリ',
        },
      ],
    },
  },

  runtimeConfig: {
    // Server-only secrets & GCP server config (NEVER expose under runtimeConfig.public)
    openaiApiKey: '',
    openaiModel: 'gpt-4.1-mini',
    gcpProjectId: '',
    gcsBucketName: '',
    gcpClientEmail: '',
    gcpPrivateKey: '',
    appPublicOrigin: '',
    hubAccountMappingsJson: '',
    ssoEnabled: false,
    ssoProviderOrigin: '',
    ssoAllowedIssuer: 'team-management',
    ssoSharedSecret: '',
    a2aEnabled: false,
    a2aWriteEnabled: false,
    a2aSharedSecret: '',
    a2aAllowedIssuer: 'team-management',
    a2aCallersJson: '',

    // Public client-safe Firebase Web Config (overridden via NUXT_PUBLIC_*)
    public: {
      ssoEnabled: false,
      firebaseApiKey: '',
      firebaseAuthDomain: '',
      firebaseProjectId: '',
    },
  },
})
