import axios from 'axios'
import draggable from 'vuedraggable'
import multiSelect from 'vue-multi-select'
// import 'vue-multi-select/dist/lib/vue-multi-select.css'
import 'vue-multi-select/dist/lib/vue-multi-select.min.css' // 3.15.0
import { mapGetters } from 'vuex'
import OmMcwDialog from '@/om-mcw/OmMcwDialog'
import OmMcwSnackbar from '@/om-mcw/OmMcwSnackbar'

import { GET } from '@/store'
import * as Mdf from '@/modelCommon'
import * as Pcvt from './pivot-cvt'
import * as Puih from './pivot-ui-helper'
import PvTable from './PvTable'
import { default as ParamInfoDialog } from './ParameterInfoDialog'

const SUB_ID_DIM = 'SubId' // sub-value id dminesion name

export default {
  components: { multiSelect, draggable, PvTable, ParamInfoDialog, OmMcwDialog, OmMcwSnackbar },

  props: {
    digest: '',
    paramName: '',
    runOrSet: '',
    nameDigest: ''
  },

  /* eslint-disable no-multi-spaces */
  data () {
    return {
      loadDone: false,
      loadWait: false,
      saveDone: false,
      saveWait: false,
      isNullable: false,  // if true then parameter value can be NULL
      isWsView: false,    // if true then page view is a workset else model run
      paramText: Mdf.emptyParamText(),
      paramSize: Mdf.emptyParamSize(),
      paramType: Mdf.emptyTypeText(),
      paramRunSet: Mdf.emptyParamRunSet(),
      subCount: 0,
      dimProp: [],
      colFields: [],
      rowFields: [],
      otherFields: [],
      filterState: {},
      pvRef: 'pv-' + this.digest + '-' + this.paramName + '-' + this.runOrSet + '-' + this.nameDigest,
      inpData: Object.freeze([]),
      ctrl: {
        isShowPvControls: true,
        isRowColNamesToggle: true,
        isPvTickle: false,
        isPvDimsTickle: false,
        formatOpts: void 0  // hide format controls by default
      },
      pvc: {
        isRowColNames: true,
        readValue: (r) => (!r.IsNull ? r.Value : (void 0)),
        processValue: Pcvt.asIsPval,    // default value processing: return as is
        formatter: Pcvt.formatDefault,  // disable format(), parse() and validation by default
        cellClass: 'pv-cell-right'         // default cell value style: right justified number
      },
      pvKeyPos: [],   // position of each dimension item in cell key
      edt: {          // editor options and state shared with child
        isEnabled: false,       // if true then edit value
        kind: Pcvt.EDIT_NUMBER, // default: numeric float or integer editor
        // current editor state
        isEdit: false,    // if true then edit in progress
        isUpdated: false, // if true then cell value(s) updated
        cellKey: '',      // current eidtor focus cell
        cellValue: '',    // current eidtor input value
        updated: {},      // updated cells
        history: [],      // update history
        lastHistory: 0    // length of update history, changed by undo-redo
      },
      multiSel: {
        dragging: false,
        rcOpts: {
          multi: true,
          labelName: 'text',
          labelValue: 'value',
          cssSelected: item => (item.selected ? 'background-color: whitesmoke;' : '')
        },
        otherOpts: {
          multi: false,
          labelName: 'text',
          labelValue: 'value',
          cssSelected: item => (item.selected ? 'background-color: whitesmoke;' : '')
        },
        filters: [{
          nameAll: 'Select all',
          nameNotAll: 'Deselect all',
          func: () => true
        }]
      },
      msg: ''
    }
  },
  /* eslint-enable no-multi-spaces */

  computed: {
    routeKey () {
      return [this.digest, this.paramName, this.runOrSet, this.nameDigest].toString()
    },
    ...mapGetters({
      theModel: GET.THE_MODEL,
      theRunText: GET.THE_RUN_TEXT,
      theWorksetText: GET.THE_WORKSET_TEXT,
      omppServerUrl: GET.OMPP_SRV_URL
    })
  },

  watch: {
    routeKey () {
      this.initView()
      this.doRefreshDataPage()
    }
  },

  methods: {
    paramDescr () { return Mdf.descrOfDescrNote(this.paramText) },

    // show parameter info dialog
    showParamInfo () {
      this.$refs.noteDlg.showParamInfo(this.paramName, this.subCount)
    },
    // show or hide extra controls
    toggleRowColNames () {
      this.pvc.isRowColNames = !this.pvc.isRowColNames
    },
    togglePivotControls () {
      this.ctrl.isShowPvControls = !this.ctrl.isShowPvControls
    },
    // show more decimals (or more details) in table body
    showMoreFormat () {
      if (!this.pvc.formatter) return
      this.pvc.formatter.doMore()
      this.$refs[this.pvRef].doRefreshFormat()
    },
    // show less decimals (or less details) in table body
    showLessFormat () {
      if (!this.pvc.formatter) return
      this.pvc.formatter.doLess()
      this.$refs[this.pvRef].doRefreshFormat()
    },
    // reset table view to default
    doResetView () {
      if (this.pvc.formatter) {
        this.pvc.formatter.resetOptions()
      }
      this.setDefaultPageView()
      this.doRefreshDataPage()
    },
    // pivot table view updated
    onPvKeyPos (kp) {
      this.pvKeyPos = kp
    },

    // copy tab separated values to clipboard
    copyToClipboard () {
      this.$refs[this.pvRef].tsvToClipboard()
    },
    // paste tab separated values from clipboard
    pasteFromClipboard () {
      this.$refs[this.pvRef].tsvFromClipboard()
    },

    // start of editor methods
    //
    // start or stop parameter editing
    doEditToogle () {
      if (this.edt.isEdit && this.edt.isUpdated) { // redirect to dialog to confirm "discard changes?"
        this.$refs.paramEditDiscardDlg.open()
        return
      }
      let isEditNow = this.edt.isEdit
      this.resetEdit()
      this.edt.isEdit = !isEditNow
    },
    onEditDiscardClosed (e) {
      if ((e.action || '') === 'accept') this.resetEdit() // question: "discard changes?", user answer: "yes"
    },

    // save if data editied
    doEditSave () {
      this.doSaveDataPage()
    },
    // undo last edit changes
    onUndo () {
      this.$refs[this.pvRef].doUndo()
    },
    onRedo () {
      this.$refs[this.pvRef].doRedo()
    },

    // show message, ex: "invalid value entered"
    onPvMessage (msg) {
      this.$refs.paramSnackbarMsg.doOpen({labelText: msg})
    },

    // clean edit state and history
    resetEdit () {
      this.edt.isEdit = false
      this.edt.isUpdated = false
      this.edt.cellKey = ''
      this.edt.cellValue = ''
      this.edt.updated = {}
      this.edt.history = []
      this.edt.lastHistory = 0
    },
    //
    // end of editor methods

    onDrag () {
      // drag started
      this.multiSel.dragging = true
    },
    onDrop () {
      // drag completed: drop
      this.multiSel.dragging = false

      // other dimensions: use single-select dropdown
      // change dropdown label: for other dimensions use selected value
      let isSelUpdate = false
      let isSubIdSelUpdate = false
      for (let f of this.otherFields) {
        if (f.selection.length > 1) {
          f.selection.splice(1)
          isSelUpdate = true
          if (f.name === SUB_ID_DIM) isSubIdSelUpdate = true
        }
        f.selLabel = Puih.makeSelLabel(false, f.label, f.selection)
      }
      for (let f of this.colFields) {
        f.selLabel = Puih.makeSelLabel(true, f.label, f.selection)
      }
      for (let f of this.rowFields) {
        f.selLabel = Puih.makeSelLabel(true, f.label, f.selection)
      }
      // make sure at least one item selected in each dimension
      for (let f of this.dimProp) {
        if (f.selection.length < 1) {
          f.selection.push(f.enums[0])
          isSelUpdate = true
          if (f.name === SUB_ID_DIM) isSubIdSelUpdate = true
        }
      }

      // update pivot view:
      //   if selection changed then pivot table view updated by multi-select input event
      //   else
      //     if other dimesions filters same as before then update pivot table view now
      //     else refresh data
      if (!isSelUpdate) {
        if (Puih.equalFilterState(this.filterState, this.otherFields, SUB_ID_DIM)) {
          this.ctrl.isPvTickle = !this.ctrl.isPvTickle
          if (isSubIdSelUpdate) {
            this.filterState = Puih.makeFilterState(this.otherFields)
          }
        } else {
          this.doRefreshDataPage()
        }
      }
    },

    // multi-select input: drag-and-drop or selection changed
    onSelectInput (panel, name, vals) {
      if (this.multiSel.dragging) return // exit: this is drag-and-drop, no changes in selection yet

      // update pivot view:
      //   if other dimesions filters same as before then update pivot table view now
      //   else refresh data
      if (panel !== 'other' || Puih.equalFilterState(this.filterState, this.otherFields, SUB_ID_DIM)) {
        this.ctrl.isPvTickle = !this.ctrl.isPvTickle
        if (name === SUB_ID_DIM) {
          this.filterState = Puih.makeFilterState(this.otherFields)
        }
      } else {
        this.doRefreshDataPage()
      }
    },

    // initialize current page view on mounted or tab switch
    initView () {
      // find parameter, parameter type and size, including run sub-values count
      this.isWsView = ((this.runOrSet || '') === Mdf.SET_OF_RUNSET)
      this.paramText = Mdf.paramTextByName(this.theModel, this.paramName)
      this.paramSize = Mdf.paramSizeByName(this.theModel, this.paramName)
      this.paramType = Mdf.typeTextById(this.theModel, (this.paramText.Param.TypeId || 0))
      this.paramRunSet = Mdf.paramRunSetByName(
        this.isWsView ? this.theWorksetText : this.theRunText,
        this.paramName)
      this.subCount = this.paramRunSet.SubCount || 0
      this.isNullable = this.paramText.Param.hasOwnProperty('IsExtendable') && (this.paramText.Param.IsExtendable || false)

      // adjust controls
      this.edt.isEnabled = this.isWsView && !this.theWorksetText.IsReadonly
      this.resetEdit() // clear editor state

      let isRc = this.paramSize.rank > 0 || this.subCount > 1
      this.pvc.isRowColNames = isRc
      this.ctrl.isRowColNamesToggle = isRc
      this.ctrl.isShowPvControls = isRc
      this.pvKeyPos = []

      // make dimensions:
      //  [rank] of enum-based dimensions
      //  sub-value id dimension, if parameter has sub-values
      this.dimProp = []

      for (let n = 0; n < this.paramText.ParamDimsTxt.length; n++) {
        const dt = this.paramText.ParamDimsTxt[n]
        let t = Mdf.typeTextById(this.theModel, (dt.Dim.TypeId || 0))
        let f = {
          name: dt.Dim.Name || '',
          label: Mdf.descrOfDescrNote(dt) || dt.Dim.Name || '',
          read: (r) => (r.DimIds.length > n ? r.DimIds[n] : void 0),
          enums: Array(t.TypeEnumTxt.length),
          selection: [],
          selLabel: () => ('Select...')
        }

        for (let j = 0; j < t.TypeEnumTxt.length; j++) {
          let eId = t.TypeEnumTxt[j].Enum.EnumId
          f.enums[j] = {
            value: eId,
            text: Mdf.enumDescrOrCodeById(t, eId) || t.TypeEnumTxt[j].Enum.Name || eId.toString()
          }
        }

        this.dimProp.push(f)
      }

      // if parameter has sub-values then add sub-value id dimension
      if (this.subCount > 1) {
        let f = {
          name: SUB_ID_DIM,
          label: 'Sub #',
          read: (r) => (r.SubId),
          enums: Array(this.subCount),
          selection: [],
          selLabel: () => ('Select...')
        }
        for (let k = 0; k < this.subCount; k++) {
          f.enums[k] = { value: k, text: k.toString() }
        }
        this.dimProp.push(f)
      }

      // setup process value and format value handlers:
      //  if parameter type is one of built-in then process and format value as float, int, boolen or string
      //  else parameter type is enum-based: process and format value as int enum id
      this.pvc.processValue = Pcvt.asIsPval
      this.pvc.formatter = Pcvt.formatDefault({isNullable: this.isNullable})
      this.pvc.cellClass = 'pv-cell-right' // numeric cell value style by default
      this.ctrl.formatOpts = void 0
      this.edt.kind = Pcvt.EDIT_NUMBER

      if (Mdf.isBuiltIn(this.paramType.Type)) {
        if (Mdf.isFloat(this.paramType.Type)) {
          this.pvc.processValue = Pcvt.asFloatPval
          this.pvc.formatter = Pcvt.formatFloat({isNullable: this.isNullable, nDecimal: -1, groupSep: ','}) // decimal: -1 is to show source float value
        }
        if (Mdf.isInt(this.paramType.Type)) {
          this.pvc.processValue = Pcvt.asIntPval
          this.pvc.formatter = Pcvt.formatInt({isNullable: this.isNullable, groupSep: ','})
        }
        if (Mdf.isBool(this.paramType.Type)) {
          this.pvc.processValue = Pcvt.asBoolPval
          this.pvc.cellClass = 'pv-cell-center'
          this.pvc.formatter = Pcvt.formatBool()
          this.edt.kind = Pcvt.EDIT_BOOL
        }
        if (Mdf.isString(this.paramType.Type)) {
          this.pvc.cellClass = 'pv-cell-left' // no process or format value required for string type
          this.edt.kind = Pcvt.EDIT_STRING
        }
      } else {
        // if parameter is enum-based then value is integer enum id and format(value) should return enum description to display
        const t = this.paramType
        let valEnums = Array(t.TypeEnumTxt.length)
        for (let j = 0; j < t.TypeEnumTxt.length; j++) {
          let eId = t.TypeEnumTxt[j].Enum.EnumId
          valEnums[j] =  {
            value: eId,
            text: Mdf.enumDescrOrCodeById(t, eId) || t.TypeEnumTxt[j].Enum.Name || eId.toString()
          }
        }
        this.pvc.processValue = Pcvt.asIntPval
        this.pvc.formatter = Pcvt.formatEnum({enums: valEnums})
        this.pvc.cellClass = 'pv-cell-left'
        this.edt.kind = Pcvt.EDIT_ENUM
      }

      this.ctrl.formatOpts = this.pvc.formatter.options()

      // set columns layout and refresh the data
      this.setDefaultPageView()
      this.ctrl.isPvDimsTickle = !this.ctrl.isPvDimsTickle
    },

    // set default page view parameters
    setDefaultPageView () {
      // set rows, columns and other:
      //   first dimension on rows
      //   last dimension on columns
      //   the rest on other fields
      let rf = []
      let cf = []
      let tf = []
      if (this.dimProp.length > 0) rf.push(this.dimProp[0])
      if (this.dimProp.length > 1) cf.push(this.dimProp[this.dimProp.length - 1])

      for (let k = 0; k < this.dimProp.length; k++) {
        let f = this.dimProp[k]
        f.selection = []

        // rows and columns: multiple selection, other: single selection
        let isOther = k > 0 && k < this.dimProp.length - 1
        if (isOther) {
          tf.push(f)
          f.selection.push(f.enums[0])
        } else {
          for (const e of f.enums) {
            f.selection.push(e)
          }
        }

        f.selLabel = Puih.makeSelLabel(!isOther, f.label, f.selection)
      }

      this.rowFields = rf
      this.colFields = cf
      this.otherFields = tf

      this.resetEdit() // clear editor state
    },

    // get page of parameter data from current model run or workset
    async doRefreshDataPage () {
      this.loadDone = false
      this.loadWait = true
      this.msg = 'Loading...'

      // exit if parameter not found in model run or workset
      if (!Mdf.isParamRunSet(this.paramRunSet)) {
        let m = 'Parameter not found in ' + this.nameDigest
        this.msg = m
        console.log(m)
        this.loadWait = false
        return
      }

      // save filters: other dimensions selected items
      this.filterState = Puih.makeFilterState(this.otherFields)

      // make parameter read layout and url
      let layout = Puih.makeSelectLayout(this.paramName, this.otherFields, SUB_ID_DIM)
      let u = this.omppServerUrl +
        '/api/model/' + (this.digest || '') +
        (this.isWsView ? '/workset/' : '/run/') + (this.nameDigest || '') +
        '/parameter/value-id'

      // retrieve page from server, it must be: {Layout: {...}, Page: [...]}
      try {
        const response = await axios.post(u, layout)
        const rsp = response.data
        let d = []
        if (!!rsp && rsp.hasOwnProperty('Page')) {
          if ((rsp.Page.length || 0) > 0) d = rsp.Page
        }

        // update pivot table view
        this.inpData = Object.freeze(d)
        this.loadDone = true
        this.ctrl.isPvTickle = !this.ctrl.isPvTickle
      } catch (e) {
        let em = ''
        try {
          if (e.response) em = e.response.data || ''
        } finally {}
        this.msg = 'Server offline or parameter data not found.'
        console.log('Server offline or parameter data not found.', em)
      }
      this.loadWait = false
    },

    // save page of parameter data into current workset
    async doSaveDataPage () {
      this.saveDone = false
      this.saveWait = true
      this.msg = 'Saving...'

      // exit if parameter not found in model run or workset
      if (!Mdf.isParamRunSet(this.paramRunSet)) {
        let m = 'Parameter not found in ' + this.nameDigest
        this.msg = m
        console.log(m)
        this.saveWait = false
        return
      }

      // prepare parameter data for save, exit with error if no changes found
      let pv = Puih.makePageForSave(
        this.dimProp, this.pvKeyPos, this.paramSize.rank, SUB_ID_DIM, this.isNullable, this.edt.updated
        )
      if (!Mdf.lengthOf(pv)) {
        this.msg = 'No parameter changes, nothing to save.'
        console.log('No parameter changes, nothing to save.')
        this.saveWait = false
        return
      }

      // url to update parameter data
      let u = this.omppServerUrl +
        '/api/model/' + (this.digest || '') +
        '/workset/' + (this.nameDigest || '') +
        '/parameter/' + (this.paramName || '') + '/new/value-id'

      // send data page to the server, response body expected to be empty
      try {
        const response = await axios.patch(u, pv)
        const rsp = response.data
        if ((rsp || '') !== '') console.log('Server reply:', rsp)

        // success: clear edit history and refersh data
        this.saveDone = true
        this.resetEdit()

        this.$nextTick(() => { this.doRefreshDataPage() })
      } catch (e) {
        let em = ''
        try {
          if (e.response) em = e.response.data || ''
        } finally {}
        this.msg = 'Server offline or parameter save failed.'
        console.log('Server offline or parameter save failed.', em)
      }
      this.saveWait = false
    }
  },

  mounted () {
    this.saveDone = true
    this.initView()
    this.doRefreshDataPage()
    this.$emit('tab-mounted', 'parameter', this.paramName)
  }
}
