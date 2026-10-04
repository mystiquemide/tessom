import {allocation, defect, fabric, objectTypes, placement, repeat, templatePiece} from './objects'
import {commerceState} from './commerceState'
import {order} from './order'
import {owner} from './owner'
import {productTemplate} from './productTemplate'
import {remnant} from './remnant'
import {submission} from './submission'

export {allocation, defect, fabric, placement, repeat, templatePiece}
export {commerceState, order, owner, productTemplate, remnant, submission}

export const schemaTypes = [owner, remnant, productTemplate, order, commerceState, submission, ...objectTypes]
