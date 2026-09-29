const report = require('../../utils/report')

Component({
  data: {
    show: false,
    reasons: report.REPORT_REASONS
  },

  methods: {
    noop() {},

    open(opts = {}) {
      this._opts = opts
      this.setData({ show: true })
    },

    close() {
      this.setData({ show: false })
    },

    onPick(e) {
      const id = e.currentTarget.dataset.id
      const reason = report.REPORT_REASONS.find((item) => item.id === id)
      const opts = this._opts || {}
      this.setData({ show: false })
      if (!reason) return
      report.submitChosen(reason, opts)
    }
  }
})
