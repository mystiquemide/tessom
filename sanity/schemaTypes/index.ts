import {allocation, defect, fabric, objectTypes, placement, repeat, templatePiece} from './objects'
import {commerceState} from './commerceState'
import {order} from './order'
import {owner} from './owner'
import {productTemplate} from './productTemplate'
import {remnant} from './remnant'

export {allocation, defect, fabric, placement, repeat, templatePiece}
export {commerceState, order, owner, productTemplate, remnant}

export const schemaTypes = [owner, remnant, productTemplate, order, commerceState, ...objectTypes]
