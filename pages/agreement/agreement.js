const { updatedAt, effectiveAt, agreementSections } = require('../../utils/legal')

Page({
  data: {
    updatedAt,
    effectiveAt,
    sections: agreementSections.filter((item) => item.title)
  }
})
