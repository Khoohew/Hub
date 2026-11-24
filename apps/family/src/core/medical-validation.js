const TYPES=new Set(["allergy","condition","medication","surgery","vaccination","test","visit","hospitalization","other"]);
const STATUSES=new Set(["active","stopped","unknown"]);
const SEVERITIES=new Set(["mild","moderate","severe","unknown"]);
function validDate(value){if(value==null||value==="")return true;if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+"T00:00:00Z");return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===value;}

export function validateMedicalRecord(record,personIds){
  const errors=[];
  if(!record||typeof record!=="object"||Array.isArray(record))return {valid:false,errors:["醫療紀錄格式錯誤"]};
  if(!TYPES.has(record.recordType))errors.push("醫療紀錄類型不正確");
  if(typeof record.personRef!=="string"||!personIds.has(record.personRef))errors.push("醫療紀錄關聯的人物不存在");
  if(typeof record.summary!=="string"||!record.summary.trim())errors.push("請填寫醫療紀錄摘要");
  if(!validDate(record.recordDate))errors.push("醫療紀錄日期格式錯誤");
  if(!validDate(record.endDate))errors.push("結束日期格式錯誤");
  if(record.recordDate&&record.endDate&&record.endDate<record.recordDate)errors.push("結束日期不能早於紀錄日期");
  if(record.recordType==="medication"){
    if(!record.medication||typeof record.medication.name!=="string"||!record.medication.name.trim())errors.push("用藥紀錄必須填寫藥物名稱");
    if(record.medication&&!STATUSES.has(record.medication.status))errors.push("用藥狀態不正確");
    if(record.medication&&(!validDate(record.medication.startDate)||!validDate(record.medication.endDate)))errors.push("用藥日期格式錯誤");
  }
  if(record.recordType==="allergy"){
    if(!record.allergy||typeof record.allergy.substance!=="string"||!record.allergy.substance.trim())errors.push("過敏紀錄必須填寫過敏物質");
    if(record.allergy&&!SEVERITIES.has(record.allergy.severity))errors.push("過敏嚴重程度不正確");
  }
  if(record.sourceMediaIds!==undefined&&!Array.isArray(record.sourceMediaIds))errors.push("醫療來源附件清單格式錯誤");
  if(record.verifiedByUser!==undefined&&typeof record.verifiedByUser!=="boolean")errors.push("核實狀態格式錯誤");
  return {valid:errors.length===0,errors};
}
