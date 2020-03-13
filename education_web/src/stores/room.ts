import { platform } from './../utils/platform';
import { AgoraElectronClient } from './../utils/agora-electron-client';
import { ChatMessage, AgoraStream } from '../utils/types';
import {Subject} from 'rxjs';
import {Map, Set, List} from 'immutable';
import AgoraRTMClient, { RoomMessage } from '../utils/agora-rtm-client';
import {globalStore} from './global';
import AgoraWebClient from '../utils/agora-rtc-client';
import {get} from 'lodash';
import { isElectron } from '../utils/platform';
import GlobalStorage from '../utils/custom-storage';
import { t } from '../i18n';
import { agoraOpenEduApi } from '../services/agora-openedu-api';

function canJoin({onlineStatus, roomType, channelCount, role}: {onlineStatus: any, role: string, channelCount: number, roomType: number}) {
  const result = {
    permitted: true,
    reason: ''
  }
  const channelCountLimit = [2, 17, 32];

  let maximum = channelCountLimit[roomType];
  if (channelCount >= maximum) {
    result.permitted = false;
    result.reason = t('toast.teacher_and_student_over_limit');
    return result;
  }

  const teacher = get(onlineStatus, 'teacher', false);
  const totalCount: number = get(onlineStatus, 'totalCount', 0);

  if (role === 'teacher') {
    const isOnline = teacher;
    if (isOnline) {
      result.permitted = false;
      result.reason = t('toast.teacher_exists');
      return result;
    }
  }

  if (role === 'student') {
    if (totalCount+1 > maximum) {
      result.permitted = false;
      result.reason = t('toast.student_over_limit');
      return result;
    }
  }

  return result;
}


export interface AgoraUser {
  uid: string
  account: string
  role: string
  video: number
  audio: number
  chat: number
  boardId: string // whiteboard_uuid
  sharedId: number // shared_uid
  linkId: number // link_uid
  lockBoard?: number // lock_board
  grantBoard: number
}

export interface ClassState {
  rid: string
  roomName: string
  teacherId: string
  roomType: number
  boardId: string // whiteboard_uuid
  sharedId: number // shared_uid
  linkId: number // link_uid
  lockBoard: number // lock_board
  courseState: number 
  muteChat: number
}

type RtcState = {
  rtcToken: string
  published: boolean
  joined: boolean
  users: Set<number>
  shared: boolean
  localStream: AgoraMediaStream | null
  localSharedStream: AgoraMediaStream | null
  remoteStreams: Map<number, AgoraMediaStream>
}

export type MediaDeviceState = {
  microphoneId: string
  speakerId: string
  cameraId: string
  speakerVolume: number
  camera: number
  microphone: number
  speaker: number
}

export type SessionInfo = {
  uid: string
  rid: string
  account: string
  roomName: string
  roomType: number
  role: string
}

export type RtmState = {
  joined: boolean
  rtmToken: string
  memberCount: number
}

export type RoomState = {
  appID: string
  rtcToken: string
  rtmToken: string
  boardId: string
  boardToken: string
  rtmLock: boolean
  uuid: string
  homePage: string
  me: AgoraUser
  users: Map<string, AgoraUser>
  course: ClassState
  applyUid: number
  rtc: RtcState
  rtm: RtmState
  mediaDevice: MediaDeviceState
  messages: List<ChatMessage>
  language: string
}

export type AgoraMediaStream = {
  streamID: number
  stream?: any
}

export class RoomStore {
  private subject: Subject<RoomState> | null;
  public _state: RoomState;

  get state () {
    return this._state;
  }

  set state (newState) {
    this._state = newState;
  }
  public readonly defaultState: RoomState = Object.freeze({
    rtmLock: false,
    boardId: '',
    boardToken: '',
    me: {
      account: "",
      uid: "",
      role: "",
      video: 1,
      audio: 1,
      chat: 1,
      linkId: 0,
      sharedId: 0,
      boardId: '',
    },
    users: Map<string, AgoraUser>(),
    applyUid: 0,
    rtm: {
      joined: false,
      memberCount: 0,
    },
    rtc: {
      published: false,
      joined: false,
      shared: false,
      users: Set<number>(),
      localStream: null,
      localSharedStream: null,
      remoteStreams: Map<number, AgoraMediaStream>(),
    },
    course: {
      teacherId: '',
      boardId: '',
      sharedId: 0,
      linkId: 0,
      courseState: 0,
      muteChat: 0,
      rid: '',
      roomName: '',
      roomType: 0,
    },
    mediaDevice: {
      microphoneId: '',
      speakerId: '',
      cameraId: '',
      speakerVolume: 100,
      camera: 0,
      speaker: 0,
      microphone: 0
    },
    messages: List<ChatMessage>(),
    language: navigator.language,
    ...GlobalStorage.read('edu_agora_room')
  });

  private applyLock: number = 0;

  public windowId: number = 0;

  public rtmClient: AgoraRTMClient;
  public rtcClient: AgoraWebClient | AgoraElectronClient;

  constructor() {
    this.subject = null;
    this._state = {
      ...this.defaultState
    };
    this.rtmClient = new AgoraRTMClient();
    this.rtcClient = isElectron ? new AgoraElectronClient ({roomStore: this}) : new AgoraWebClient({roomStore: this});
  }

  initialize() {
    this.subject = new Subject<RoomState>();
    this.state = {
      ...this.defaultState,
    }
    this.applyLock = 0;
    this.subject.next(this.state);
  }

  get applyUid () {
    return this.applyLock;
  }

  subscribe(updateState: any) {
    this.initialize();
    this.subject && this.subject.subscribe(updateState);
  }

  unsubscribe() {
    this.subject && this.subject.unsubscribe();
    this.subject = null;
  }

  commit (state: RoomState) {
    this.subject && this.subject.next(state);
  }

  updateState(rootState: RoomState) {
    this.state = {
      ...this.state,
      ...rootState,
    }
    this.commit(this.state);
  }

  isTeacher(peerId: string) {
    if (peerId === this.state.course.teacherId) return true;
    return false;
  }

  isStudent (peerId: string) {
    if (peerId !== this.state.course.teacherId) return true;
  }

  addLocalStream(stream: AgoraStream) {
    this.state = {
      ...this.state,
      rtc: {
        ...this.state.rtc,
        localStream: stream
      }
    }
    this.commit(this.state);
  }

  removeLocalStream() {
    this.state = {
      ...this.state,
      rtc: {
        ...this.state.rtc,
        localStream: null,
        localSharedStream: null
      }
    }
    this.commit(this.state);
  }

  addLocalSharedStream(stream: any) {
    this.state = {
      ...this.state,
      rtc: {
        ...this.state.rtc,
        localSharedStream: stream
      }
    }
    this.commit(this.state);
  }

  removeLocalSharedStream() {
    this.state = {
      ...this.state,
      rtc: {
        ...this.state.rtc,
        localSharedStream: null
      }
    }
    this.commit(this.state);
  }

  addPeerUser(uid: number) {
    this.state = {
      ...this.state,
      rtc: {
        ...this.state.rtc,
        users: this.state.rtc.users.add(uid),
      }
    }
    this.commit(this.state);
  }

  removePeerUser(uid: number) {
    this.state = {
      ...this.state,
      rtc: {
        ...this.state.rtc,
        users: this.state.rtc.users.delete(uid),
      }
    }
    this.commit(this.state);
  }

  addRemoteStream(stream: AgoraStream) {
    this.state = {
      ...this.state,
      rtc: {
        ...this.state.rtc,
        remoteStreams: this.state.rtc.remoteStreams.set(stream.streamID, stream)
      }
    }
    this.commit(this.state);
  }

  removeRemoteStream(uid: number) {
    const remoteStream = this.state.rtc.remoteStreams.get(uid);
    if (platform === 'web') {
      if (remoteStream && remoteStream.stream && remoteStream.stream.isPlaying) {
        remoteStream.stream.isPlaying() && remoteStream.stream.stop();
      }
    }


    this.state = {
      ...this.state,
      rtc: {
        ...this.state.rtc,
        remoteStreams: this.state.rtc.remoteStreams.delete(uid)
      }
    }
  }

  updateMemberCount(count: number) {
    this.state = {
      ...this.state,
      rtm: {
        ...this.state.rtm,
        memberCount: count,
      }
    }
    this.commit(this.state);
  }

  updateRtc(newState: any) {
    this.state = {
      ...this.state,
      rtc: {
        ...this.state.rtc,
        ...newState,
      }
    }
    this.commit(this.state);
  }

  updateDevice(state: MediaDeviceState) {
    this.state = {
      ...this.state,
      mediaDevice: state
    }
    this.commit(this.state);
  }

  async handlePeerMessage({cmd, account}: {cmd: RoomMessage, account: string}, peerId: string) {
    if (!peerId) return console.warn('state is not assigned');
    const myUid = this.state.me.uid;
    console.log("Teacher: ", this.isTeacher(myUid) , ", peerId: ", this.isStudent(peerId));
    // student follow teacher peer message
    if (!this.isTeacher(myUid) && this.isTeacher(peerId)) {

      const me = this.state.me;
      switch(cmd) {
        case RoomMessage.muteChat: {
          return await this.updateMe({...me, chat: 0});
        }
        case RoomMessage.muteAudio: {
          return await this.updateMe({...me, audio: 0});
        }
        case RoomMessage.muteVideo: {
          return await this.updateMe({...me, video: 0});
        }
        case RoomMessage.muteBoard: {
          globalStore.showToast({
            type: 'notice',
            message: t('toast.teacher_cancel_whiteboard'),
          });
          return await this.updateMe({...me, grantBoard: 0});
        }
        case RoomMessage.unmuteAudio: {
          return await this.updateMe({...me, audio: 1});
        }
        case RoomMessage.unmuteVideo: {
          return await this.updateMe({...me, video: 1});
        }
        case RoomMessage.unmuteChat: {
          return await this.updateMe({...me, chat: 1});
        }
        case RoomMessage.unmuteBoard: {
          globalStore.showToast({
            type: 'notice',
            message: t('toast.teacher_accept_whiteboard')
          });
          return await this.updateMe({...me, grantBoard: 1});
        }
        case RoomMessage.acceptCoVideo: {
          globalStore.showToast({
            type: 'co-video',
            message: t("toast.teacher_accept_co_video")
          });
          return;
        }
        case RoomMessage.rejectCoVideo: {
          globalStore.showToast({
            type: 'co-video',
            message: t("toast.teacher_reject_co_video")
          });
          return;
        }
        case RoomMessage.cancelCoVideo: {
          globalStore.showToast({
            type: 'co-video',
            message: t("toast.teacher_cancel_co_video")
          });
          return;
        }
        default:
      }
      return;
    }

    // when i m teacher & received student message
    if (this.isTeacher(myUid) && this.isStudent(peerId)) {
      switch(cmd) {
        case RoomMessage.applyCoVideo: {
          // WARN: LOCK
          if (this.state.course.linkId) {
            return console.warn('already received apply id: ', this.applyLock);
          }
          const applyUser = roomStore.state.users.get(`${peerId}`);
          if (applyUser) {
            this.applyLock = +peerId;
            console.log("applyUid: ", this.applyLock);
            this.state = {
              ...this.state,
              applyUid: this.applyLock,
            }
            this.commit(this.state);
            globalStore.showNotice({
              reason: 'peer_hands_up',
              text: t('notice.student_interactive_apply', {reason: applyUser.account}),
            });
          }
          return;
        }
        case RoomMessage.cancelCoVideo: {
          // WARN: LOCK
          if (this.state.course.linkId && `${this.state.course.linkId}` === peerId) {
            roomStore.updateCourseLinkUid(0).then(() => {
            }).catch(console.warn);

            globalStore.showToast({
              type: 'co-video',
              message: t('toast.student_cancel_co_video')
            });
          }
          return;
        }
        default:
      }
      return;
    }
  }

  async mute(uid: string, type: string) {
    const me = this.state.me;
    if (me.uid === `${uid}`) {
      if (type === 'audio') {
        await this.updateAttrsBy(me.uid, {
          audio: 0
        });
      }
      if (type === 'video') {
        await this.updateAttrsBy(me.uid, {
          video: 0
        });
      }
      if (type === 'chat') {
        await this.updateAttrsBy(me.uid, {
          chat: 0
        });
      }
      // if (type === 'grantBoard') {
      //   await this.updateAttrsBy(me.uid, {
      //     grant_board: 0
      //   });
      // }
    }
    else if (me.role === 'teacher') {
      if (type === 'audio') {
        await this.rtmClient.sendPeerMessage(`${uid}`, {cmd: RoomMessage.muteAudio});
      }
      if (type === 'video') {
        await this.rtmClient.sendPeerMessage(`${uid}`, {cmd: RoomMessage.muteVideo});
      }
      if (type === 'chat') {
        await this.rtmClient.sendPeerMessage(`${uid}`, {cmd: RoomMessage.muteChat});
      }
      if (type === 'grantBoard') {
        await this.rtmClient.sendPeerMessage(`${uid}`, {cmd: RoomMessage.muteBoard});
      }
    }
  }

  async unmute(uid: string, type: string) {
    const me = this.state.me;
    if (me.uid === `${uid}`) {
      if (type === 'audio') {
        await this.updateAttrsBy(me.uid, {
          audio: 1
        });
      }
      if (type === 'video') {
        await this.updateAttrsBy(me.uid, {
          video: 1
        });
      }
      if (type === 'chat') {
        await this.updateAttrsBy(me.uid, {
          chat: 1
        });
      }
      // if (type === 'grantBoard') {
      //   await this.updateAttrsBy(me.uid, {
      //     grant_board: 1
      //   });
      // }
    }
    else if (me.role === 'teacher') {
      if (type === 'audio') {
        await this.rtmClient.sendPeerMessage(`${uid}`, {cmd: RoomMessage.unmuteAudio});
      }
      if (type === 'video') {
        await this.rtmClient.sendPeerMessage(`${uid}`, {cmd: RoomMessage.unmuteVideo});
      }
      if (type === 'chat') {
        await this.rtmClient.sendPeerMessage(`${uid}`, {cmd: RoomMessage.unmuteChat});
      }
      if (type === 'grantBoard') {
        await this.rtmClient.sendPeerMessage(`${uid}`, {cmd: RoomMessage.unmuteBoard});
      }
    }
  }

  async LoginToRoom(payload: any, pass: boolean = false) {
    const {userName, roomName, role, type} = payload

    const me = this.state.me;
    const {room, user, appId} = await agoraOpenEduApi.entry(payload);

    await this.loginAndJoin({
      account: user.userName,
      roomType: room.type,
      roomName: room.roomName,
      role: user.role === 1 ? 'teacher' : 'studnet',
      uid: `${user.uid}`,
      rid: room.channelName,
      rtcToken: '',
      rtmToken: '',
      appId,
      video: me.video || 1,
      audio: me.audio || 1,
      chat: me.chat || 1,
      boardId: room.boardId,
      boardToken: room.boardToken,
    }, pass)

    const params = {
      uid: `${user.uid}`,
      rid: room.channelName,
      role: user.role === 1 ? 'teacher' : 'studnet',
      roomName: room.roomName,
      roomType: room.type,
      video: me.video || 1,
      audio: me.audio || 1,
      chat: me.chat || 1,
      account: user.userName,
      token: '',
      boardId: me.boardId,
      linkId: me.linkId,
      sharedId: me.sharedId,
      lockBoard: me.lockBoard,
      grantBoard: me.grantBoard,
    }

    this.updateSessionInfo(params)
  }

  async loginAndJoin(payload: any, pass: boolean = false) {
    const {boardId, boardToken, roomType, roomName, role, uid, rid, rtcToken, rtmToken, appId} = payload;

    await this.rtmClient.login(appId, uid, rtmToken);

    let result = {permitted: true, reason: ''};
    try {
      const channelMemberCount = await this.rtmClient.getChannelMemberCount([rid]);
      const channelCount = channelMemberCount[rid];
      let accounts = await this.rtmClient.getChannelAttributeBy(rid);
      const onlineStatus = await this.rtmClient.queryOnlineStatusBy(accounts);
      const argsJoin = {
        channelCount,
        onlineStatus,
        role,
        accounts,
        roomType
      };
      result = pass === false ? canJoin(argsJoin) : {permitted: true, reason: ''};
      if (result.permitted) {
        let res = await this.rtmClient.join(rid);
        const teacher = accounts.find(it => it.role === 'teacher');
        this.state = {
          ...this.state,
          appID: appId,
          boardId,
          boardToken,
          rtm: {
            ...this.state.rtm,
            joined: true
          },
          me: {
            ...this.state.me,
            boardId: boardId,
          },
          rtmToken,
          rtcToken,
          course: {
            rid,
            roomName,
            teacherId: get(teacher, 'uid', ''),
            roomType,
            boardId: get(teacher, 'whiteboard_uid', ''),
            sharedId: get(teacher, 'shared_uid', 0),
            linkId: get(teacher, 'link_uid', 0),
            lockBoard: get(teacher, 'lock_board', 0),
            courseState: get(teacher, 'class_state', 0),
            muteChat: get(teacher, 'mute_chat', 0),

            // mute_chat: this.state.course.muteChat,
            // class_state: this.state.course.courseState,
            // whiteboard_uid: this.state.course.boardId,
            // link_uid: this.state.course.linkId,
            // shared_uid: this.state.course.sharedId,

            // rid: string
            // roomName: string
            // teacherId: string
            // roomType: number
            // boardId: string // whiteboard_uuid
            // sharedId: number // shared_uid
            // linkId: number // link_uid
            // lockBoard: number // lock_board
            // courseState: number 
            // muteChat: number
          }
        }
        const grantBoard = role === 'teacher' ? 1 : 0;
        await this.updateMe({...payload, grantBoard});
        this.commit(this.state);
        return;
      }
      throw {
        type: 'not_permitted',
        reason: result.reason
      }
    } catch (err) {
      if (this.rtmClient._logged) {
        await this.rtmClient.logout();
      }
      throw err;
    }
  }

  setRTCJoined(joined: boolean) {
    this.state = {
      ...this.state,
      rtc: {
        ...this.state.rtc,
        joined
      }
    }
    this.commit(this.state);
  }

  async updateCourseLinkUid(linkId: number) {
    const me = this.state.me;
    console.log("me: link_uid", me, linkId);
    let res = await this.updateAttrsBy(me.uid, {
      link_uid: linkId
    })
    // let res = await this.updateMe({...me, linkId: linkId});
    this.applyLock = linkId;
    console.log("current apply lock: ", this.applyLock);
    return res;
  }

  async updateWhiteboardUid(uid: string) {
    const me = this.state.me;
    let res = await this.updateAttrsBy(me.uid, {
      whiteboard_uid: uid
    });
    console.log("[update whiteboard uid] res", uid);
    return res;
  }

  updateChannelMessage(msg: ChatMessage) {
    this.state = {
      ...this.state,
      messages: this.state.messages.push(msg)
    };

    this.commit(this.state);
  }

  async updateAttrsBy(uid: string, attr: any) {
    if (attr['whiteboard_uid']) {
      console.log("[update whiteboard uid], ", attr['whiteboard_uid']);
    }
    const user = this.state.users.get(uid);
    if (!user) return;
    const key = user.role === 'teacher' ? 'teacher' : uid;
    const attrs = {
      uid: user.uid,
      whiteboard_uid: user.boardId,
      link_uid: user.linkId,
      shared_uid: user.sharedId,
      account: user.account,
      video: user.video,
      audio: user.audio,
      chat: user.chat,
      grant_board: user.grantBoard,
    }
    if (user.role === 'teacher') {
      Object.assign(attrs, {
        mute_chat: this.state.course.muteChat,
        class_state: this.state.course.courseState,
        whiteboard_uid: this.state.course.boardId,
        link_uid: this.state.course.linkId,
        shared_uid: this.state.course.sharedId,
      })
    }
    if (attr) {
      Object.assign(attrs, attr);
    }
    let res = await this.rtmClient.updateChannelAttrsByKey(key, attrs);
    return res;
  }

  async updateMe(user: any) {
    const {role, uid, account, rid, video, audio, chat, boardId, linkId, sharedId, muteChat, grantBoard} = user;
    const key = role === 'teacher' ? 'teacher' : uid;
    const me = this.state.me;
    const attrs: any = {
      uid: me.uid,
      account: me.account,
      chat: me.chat,
      video: me.video,
      audio: me.audio,
    }
    Object.assign(attrs, {
      uid,
      account,
      video,
      audio,
      chat,
      whiteboard_uid: boardId,
      link_uid: linkId,
      shared_uid: sharedId,
      grant_board: grantBoard,
    });

    console.log('users', user);
    if (grantBoard !== undefined) {
      Object.assign(attrs, {
        grant_board: grantBoard,
      });
    }
    if (role === 'teacher') {
      const class_state = get(user, 'courseState', this.state.course.courseState);
      const whiteboard_uid = get(user, 'boardId', this.state.course.boardId);
      const mute_chat = get(user, 'muteChat', this.state.course.muteChat);
      const shared_uid = get(user, 'sharedId', this.state.course.sharedId);
      const link_uid = get(user, 'linkId', this.state.course.linkId);
      const lock_board = get(user, 'lockBoard', this.state.course.lockBoard);
      Object.assign(attrs, {
        mute_chat,
        class_state,
        whiteboard_uid,
        link_uid,
        shared_uid,
        lock_board
      })
      console.log("teacher attrs: >>>> ", attrs);
    }
    const roomType = user.roomType;
    this.state = {
      ...this.state,
      me: {
        ...this.state.me,
        ...me,
        boardId,
        linkId,
        sharedId,
        grantBoard
      }
    }
    this.commit({
      ...this.state,
    })
    let res = await this.rtmClient.updateChannelAttrsByKey(key, attrs);
    return res;
  }

  updateRoomAttrs ({teacher, accounts, room}: any) {
    console.log("[agora-board], room:  ", room, " teacher: ", teacher, "accounts ", accounts);
    const users = accounts.reduce((acc: Map<string, AgoraUser>, it: any) => {
      return acc.set(it.uid, {
        role: it.role,
        account: it.account,
        uid: it.uid,
        video: it.video,
        audio: it.audio,
        chat: it.chat,
        boardId: it.whiteboard_uid,
        sharedId: it.shared_uid,
        linkId: it.link_uid,
        lockBoard: it.lock_board,
        grantBoard: it.grant_board,
      });
    }, Map<string, AgoraUser>());

    const me = this.state.me;

    if (users.get(me.uid)) {
      Object.assign(me, users.get(me.uid));
    }

    if (me.role === 'teacher') {
      Object.assign(me, {
        linkId: room.link_uid,
        boardId: room.whiteboard_uid,
        lockBoard: room.lock_board,
      })
    }

    const newClassState: ClassState = {} as ClassState;
    Object.assign(newClassState, {
      teacherId: get(teacher, 'uid', 0),
      linkId: room.link_uid,
      boardId: room.whiteboard_uid,
      courseState: room.class_state,
      muteChat: room.mute_chat,
      lockBoard: room.lock_board
    })

    // console.log("... me", this.state.me);
    // console.log("... this.state.me", me);

    this.state = {
      ...this.state,
      users,
      me: {
        ...this.state.me,
        ...me,
      },
      course: {
        ...this.state.course,
        ...newClassState
      }
    }
    this.commit(this.state);
  }

  updateSessionInfo (info: any) {
    this.state = {
      ...this.state,
      course: {
        ...this.state.course,
        rid: info.rid,
        roomName: info.roomName,
        roomType: info.roomType
      },
      me: {
        ...this.state.me,
        account: info.account,
        uid: info.uid,
        role: info.role,
        video: info.video,
        audio: info.audio,
        chat: info.chat,
        linkId: info.linkId,
        sharedId: info.sharedId,
        boardId: info.boardId,
      },
      homePage: info.homePage,
    }
    this.commit(this.state);
  }

  async exitAll() {
    try {
      await this.rtmClient.exit();
    } catch(err) {
      console.warn(err);
    }
    try {
      await this.rtcClient.exit();
    } catch (err) {
      console.warn(err);
    }
    GlobalStorage.clear('edu_agora_room');
    this.state = {
      ...this.defaultState
    }
    this.commit(this.state);
  }

  setScreenShare(shared: boolean) {
    this.state = {
      ...this.state,
      rtc: {
        ...this.state.rtc,
        shared,
      }
    }
    this.commit(this.state);
  }
}

export const roomStore = new RoomStore();

//@ts-ignore
window.roomStore = roomStore;