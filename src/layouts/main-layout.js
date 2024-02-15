import { mapState, mapGetters, mapActions } from 'vuex'
import languages from 'quasar/lang/index.json'
import * as Mdf from 'src/model-common'
import ModelInfoDialog from 'components/ModelInfoDialog.vue'

const DISK_USE_MIN_REFRESH_TIME = (17 * 1000) // msec, minimum disk space usage refresh interval
const DISK_USE_MAX_ERR = 5 // max error count to stop disk use retrival and block model runs

export default {
  name: 'MainLayout',
  components: { ModelInfoDialog },

  data () {
    return {
      leftDrawerOpen: false,
      refreshTickle: false,
      loadConfigDone: false,
      loadDiskUseDone: false,
      nDdiskUseErr: 0, // disk use error count
      isBeta: true,
      modelInfoTickle: false,
      toUpDownSection: 'down',
      isDiskUse: false,
      diskUseRefreshInt: '',
      diskUseMs: DISK_USE_MIN_REFRESH_TIME,
      langCode: this.$q.lang.getLocale(),
      appLanguages: languages.filter(lang => ['fr', 'en-us'].includes(lang.isoName))
    }
  },

  computed: {
    mainTitle () {
      const t = (this.theModelDir ? this.theModelDir + '/' : '') + Mdf.modelTitle(this.theModel)
      return (t !== '') ? t : 'OpenM++'
    },
    isModel () { return Mdf.isModel(this.theModel) },
    modelDigest () { return Mdf.modelDigest(this.theModel) },
    modelName () { return Mdf.modelName(this.theModel) },
    modelDocLink () {
      return this.serverConfig.IsModelDoc ? Mdf.modelDocLinkByDigest(this.modelDigest, this.modelList, this.uiLang, this.modelLanguage) : ''
    },
    runTextCount () { return Mdf.runTextCount(this.runTextList) },
    worksetTextCount () { return Mdf.worksetTextCount(this.worksetTextList) },
    loginUrl () { return Mdf.configEnvValue(this.serverConfig, 'OM_CFG_LOGIN_URL') },
    logoutUrl () { return Mdf.configEnvValue(this.serverConfig, 'OM_CFG_LOGOUT_URL') },
    loadWait () {
      return !this.loadConfigDone
    },

    ...mapState('model', {
      theModel: state => state.theModel,
      modelList: state => state.modelList,
      theModelDir: state => state.theModelDir,
      runTextList: state => state.runTextList,
      worksetTextList: state => state.worksetTextList
    }),
    ...mapGetters('model', {
      modelCount: 'modelListCount',
      modelLanguage: 'modelLanguage'
    }),
    ...mapState('serverState', {
      omsUrl: state => state.omsUrl,
      serverConfig: state => state.config,
      diskUseState: state => state.diskUse
    }),
    ...mapState('uiState', {
      uiLang: state => state.uiLang,
      runDigestSelected: state => state.runDigestSelected,
      worksetNameSelected: state => state.worksetNameSelected,
      taskNameSelected: state => state.taskNameSelected
    })
  },

  watch: {
    // language updated outside of main menu
    uiLang () {
      if (!this.uiLang) {
        let lc = this.$q.lang.getLocale()
        if (this.appLanguages.findIndex((ln) => ln.isoName === lc) < 0) { // language not included in translation pack, use default en-us
          lc = 'en-us'
        }
        this.langCode = lc
        this.$i18n.locale = lc
      }
    },
    // switch app language: Quasar and vue i18n language
    langCode (lc) {
      // dynamic import, so loading on demand only
      import(
        /* webpackInclude: /(fr|en-us)\.js$/ */
        'quasar/lang/' + lc
      ).then(lang => {
        this.$q.lang.set(lang.default) // switch quasar language
        this.$i18n.locale = lc // switch vue app language
      }).catch(err => {
        console.warn('Error at loading language:', lc, err)
      })
    },
    isDiskUse () { this.restartDiskUseRefresh() },
    diskUseMs () { this.restartDiskUseRefresh() }
  },

  methods: {
    // show model notes dialog
    doShowModelNote () {
      this.modelInfoTickle = !this.modelInfoTickle
    },
    // new selected language in the menu
    onLangMenu (lc) {
      this.langCode = lc // switch app language by watch
      if (lc) { // use selected language for model text metadata
        this.dispatchUiLang(lc)
        this.refreshTickle = !this.refreshTickle
      }
    },

    doRefresh () {
      this.doConfigRefresh()
      this.restartDiskUseRefresh()
      this.refreshTickle = !this.refreshTickle
    },
    restartDiskUseRefresh () {
      this.nDdiskUseErr = 0
      clearInterval(this.diskUseRefreshInt)
      // refersh disk space usage now and setup refresh by timer
      if (this.isDiskUse) {
        this.doRefreshDiskUse()
        this.diskUseRefreshInt = setInterval(this.doGetDiskUse, this.diskUseMs)
      }
    },
    // refresh disk use by request
    onDiskUseRefresh () {
      if (this.isDiskUse) {
        this.doRefreshDiskUse()
      }
    },

    // view downloads page section
    onDownloadSelect (digest) {
      if (!digest) {
        this.$q.notify({ type: 'negative', message: this.$t('Unable to view downloads') })
        return
      }
      // show downloads for model selected from model list
      this.toUpDownSection = 'down'
      this.$router.push('/updown-list/model/' + encodeURIComponent(digest))
    },
    // view uploads page section
    onUploadSelect (digest) {
      if (!digest) {
        this.$q.notify({ type: 'negative', message: this.$t('Unable to view uploads') })
        return
      }
      // show uploads for model selected from model list
      this.toUpDownSection = 'up'
      this.$router.push('/updown-list/model/' + encodeURIComponent(digest))
    },

    // receive server configuration, including configuration of model catalog and run catalog
    async doConfigRefresh () {
      this.loadConfigDone = false

      const u = this.omsUrl + '/api/service/config'
      try {
        // send request to the server
        const response = await this.$axios.get(u)
        this.dispatchServerConfig(response.data) // update server config in store
      } catch (e) {
        let em = ''
        try {
          if (e.response) em = e.response.data || ''
        } finally {}
        console.warn('Server offline or configuration retrieve failed.', em)
        this.$q.notify({ type: 'negative', message: this.$t('Server offline or configuration retrieve failed.') })
      }
      this.loadConfigDone = true

      // update disk space usage if necessary
      this.isDiskUse = !!this?.serverConfig?.IsDiskUse
      this.diskUseMs = this.getDiskUseRefreshMs(this?.serverConfig?.DiskScanMs)
    },
    // get interval of disk use configuration refresh
    getDiskUseRefreshMs (ms) {
      return (!!ms && typeof ms === typeof 1 && ms >= DISK_USE_MIN_REFRESH_TIME) ? ms : DISK_USE_MIN_REFRESH_TIME
    },
    // return file size as translated string for example: 12 MB or 34 GB
    fileSizeStr (size) {
      const fs = Mdf.fileSizeParts(size)
      return fs.val + ' ' + this.$t(fs.name)
    },

    // receive disk space usage from server
    async doGetDiskUse () {
      this.loadDiskUseDone = false
      let isOk = false

      const u = this.omsUrl + '/api/service/disk-use'
      try {
        // send request to the server
        const response = await this.$axios.get(u)
        this.dispatchDiskUse(response.data) // update disk space usage in store
        isOk = Mdf.isDiskUseState(response.data) // validate disk usage info
      } catch (e) {
        let em = ''
        try {
          if (e.response) em = e.response.data || ''
        } finally {}
        console.warn('Server offline or disk usage retrieve failed.', em)
        this.$q.notify({ type: 'negative', message: this.$t('Server offline or disk space usage retrieve failed.') })
      }
      this.loadDiskUseDone = true

      // update disk space usage to notify user
      if (isOk) {
        this.isDiskUse = this.diskUseState.IsDiskUse
        this.diskUseMs = this.getDiskUseRefreshMs(this.diskUseState.DiskUse.DiskScanMs)
      } else {
        this.nDdiskUseErr++
      }

      if (this.nDdiskUseErr > DISK_USE_MAX_ERR) {
        clearInterval(this.diskUseRefreshInt)

        const du = Mdf.emptyDiskUseState()
        du.DiskUse.IsOver = true
        this.dispatchDiskUse(du) // block model runs

        console.warn('Disk usage retrieve failed:', this.nDdiskUseErr)
        this.$q.notify({ type: 'negative', message: this.$t('Disk space usage retrieve failed') })
      }
    },

    // send request to refersh disk space usage
    async doRefreshDiskUse () {
      const u = this.omsUrl + '/api/service/disk-use/refresh'
      try {
        await this.$axios.post(u) // ignore response on success
      } catch (e) {
        let em = ''
        try {
          if (e.response) em = e.response.data || ''
        } finally {}
        console.warn('Server offline or disk usage refresh failed.', em)
        this.$q.notify({ type: 'negative', message: this.$t('Server offline or disk space usage refresh failed.') })
      }

      // get disk usage from the server
      setTimeout(() => this.doGetDiskUse(), 1231)
    },

    ...mapActions('uiState', {
      dispatchUiLang: 'uiLang'
    }),
    ...mapActions('serverState', {
      dispatchServerConfig: 'serverConfig',
      dispatchDiskUse: 'diskUse'
    })
  },

  mounted () {
    this.doConfigRefresh()
  },
  beforeDestroy () {
    clearInterval(this.diskUseRefreshInt)
  },

  created () {
    // if locale for current language not avaliable then
    // find fallback locale (assuming fallback is available)
    let ln = this.langCode

    // match first part of lanuage code to avaliable locales
    if (this.$i18n.availableLocales.indexOf(ln) < 0) {
      const ui2p = Mdf.splitLangCode(ln)

      if (ui2p.first !== '') {
        for (const lcIdx in this.$i18n.availableLocales) {
          const lc = this.$i18n.availableLocales[lcIdx]

          const av2p = Mdf.splitLangCode(lc)
          if (av2p.first === ui2p.first) {
            ln = lc
            break
          }
        }
      }
    }

    if (ln && this.langCode !== ln) {
      this.langCode = ln // switch app language
    }
  }
}
