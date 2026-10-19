import test from "node:test";
import assert from "node:assert/strict";
import { collectLineGroupReplies } from "../src/lib/server/line-webhook-events.ts";

const group = "C_SYNTHETIC_GROUP";
function message(replyToken, text, source={type:"group",groupId:group}) {
  return { type:"message", source, replyToken,
    message: { type:"text", text } };
}

test("LINE batch handles both the first and later valid group events", () => {
  const events = [message("SYNTHETIC_1","เช็คไอดีกลุ่ม"),
    { type:"message", source:{type:"user",userId:"U_TEST"},replyToken:"NO",
      message:{type:"text",text:"เช็คไอดีกลุ่ม"} },
    message("SYNTHETIC_2","สวัสดี เช็คไอดีกลุ่ม ครับ"),
    { type:"join", source:{type:"group",groupId:"C_OTHER"}, replyToken:"SYNTHETIC_3" }];
  assert.deepEqual(collectLineGroupReplies(events), [
    { groupId:group, replyToken:"SYNTHETIC_1" },
    { groupId:group, replyToken:"SYNTHETIC_2" },
    { groupId:"C_OTHER", replyToken:"SYNTHETIC_3" },
  ]);
});

test("LINE skips malformed, irrelevant, non-text and untrusted reply tokens", () => {
  const events = [null,42,"bad",{}, { type:"message" },
    { type:"message",source:{type:"group",groupId:group},message:null,replyToken:"R1" },
    { type:"message",source:{type:"group",groupId:group},message:{type:"image"},replyToken:"R2" },
    { type:"join",source:{type:"group"},replyToken:"R3" },
    { type:"join",source:{type:"group",groupId:group},replyToken:99 },
    message("R4","hello"),
    message("R5","เช็คไอดีกลุ่ม",{type:"room",roomId:"R_TEST"})];
  assert.deepEqual(collectLineGroupReplies(events), []);
});

test("LINE processes each reply token at most once within a signed batch", () => {
  assert.deepEqual(collectLineGroupReplies([
    message("T1","เช็คไอดีกลุ่ม"),
    message("T1","เช็คไอดีกลุ่ม"),
    { type:"join",source:{type:"group",groupId:"C_NEW"},replyToken:"T1" },
    { type:"join",source:{type:"group",groupId:"C_NEW"},replyToken:"T2" },
  ]), [
    {groupId:group,replyToken:"T1"},
    {groupId:"C_NEW",replyToken:"T2"},
  ]);
});

test("LINE empty or unknown event collections are no-ops", () => {
  assert.deepEqual(collectLineGroupReplies([]),[]);
  assert.deepEqual(collectLineGroupReplies(null),[]);
  assert.deepEqual(collectLineGroupReplies({events:[]}),[]);
});
