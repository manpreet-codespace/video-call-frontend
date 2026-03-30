import React, { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000'
const socket = io(SOCKET_URL)

const CallScreen = ({ endCall, roomId, joinLink }) => {
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const streamRef = useRef(null);
    const pcRef = useRef(null);
    const pendingOfferRef = useRef(null);
    const queuedCandidatesRef = useRef([]);
    const remoteStreamRef = useRef(null);
    const pipWindowRef = useRef(null);
    const pipMuteButtonRef = useRef(null);
    const pipReturnButtonRef = useRef(null);
    const pipEndCallButtonRef = useRef(null);
    const videoStageRef = useRef(null);

    const [incomingCall, setIncomingCall] = useState(false);
    const [isCalling, setIsCalling] = useState(false);
    const [isInActiveCall, setIsInActiveCall] = useState(false);
    const [peerAvailable, setPeerAvailable] = useState(false);
    const [status, setStatus] = useState('Waiting for someone to join this link');
    const [isMuted, setIsMuted] = useState(false);
    const [isPipActive, setIsPipActive] = useState(false);

    const syncRemoteAudioState = () => {
        if (remoteVideoRef.current) {
            remoteVideoRef.current.muted = isMuted;
        }

        if (pipMuteButtonRef.current) {
            pipMuteButtonRef.current.textContent = isMuted ? 'Unmute' : 'Mute';
        }
    };

    const closePipWindow = async () => {
        const pipWindow = pipWindowRef.current;
        const videoStage = videoStageRef.current;

        if (videoStage && remoteVideoRef.current) {
            videoStage.prepend(remoteVideoRef.current);
            remoteVideoRef.current.style.width = '';
            remoteVideoRef.current.style.flex = '';
            remoteVideoRef.current.style.background = '';
            remoteVideoRef.current.style.objectFit = '';
            remoteVideoRef.current.style.height = '';
        }

        pipMuteButtonRef.current = null;
        pipReturnButtonRef.current = null;
        pipEndCallButtonRef.current = null;
        pipWindowRef.current = null;
        setIsPipActive(false);

        if (pipWindow && !pipWindow.closed) {
            pipWindow.close();
        }
    };

    const stopStream = () => {
        const localStream = streamRef.current;
        const remoteStream = remoteStreamRef.current ?? remoteVideoRef.current?.srcObject;

        [localStream, remoteStream].filter(Boolean).forEach((stream) => {
            stream.getTracks().forEach((track) => track.stop());
        });

        streamRef.current = null;
        remoteStreamRef.current = null;
        pendingOfferRef.current = null;
        queuedCandidatesRef.current = [];

        if (localVideoRef.current) {
            localVideoRef.current.pause();
            localVideoRef.current.srcObject = null;
        }

        if (remoteVideoRef.current) {
            remoteVideoRef.current.pause();
            remoteVideoRef.current.srcObject = null;
        }

        if (pcRef.current) {
            pcRef.current.close();
            pcRef.current = null;
        }

        closePipWindow();
    };

    const resetCallUi = (nextStatus = 'Waiting for someone to join this link') => {
        setIncomingCall(false);
        setIsCalling(false);
        setIsInActiveCall(false);
        setPeerAvailable(false);
        setStatus(nextStatus);
    };

    const handleToggleMute = () => {
        setIsMuted((current) => !current);
    };

    const ensureLocalStream = async () => {
        if (streamRef.current) {
            return streamRef.current;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
        });

        streamRef.current = stream;

        if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
        }

        return stream;
    };

    const flushQueuedCandidates = async () => {
        if (!pcRef.current) {
            return;
        }

        while (queuedCandidatesRef.current.length > 0) {
            const candidate = queuedCandidatesRef.current.shift();
            await pcRef.current.addIceCandidate(candidate);
        }
    };

    const createPeerConnection = async () => {
        if (pcRef.current) {
            return pcRef.current;
        }

        const stream = await ensureLocalStream();
        const pc = new RTCPeerConnection();

        pc.ontrack = (event) => {
            remoteStreamRef.current = event.streams[0];

            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = event.streams[0];
                remoteVideoRef.current.muted = isMuted;
            }
        };

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', { roomId, candidate: event.candidate });
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') {
                setIsCalling(false);
                setIsInActiveCall(true);
                setStatus('Call connected');
            }

            if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
                stopStream();
                resetCallUi('Call ended');
            }
        };

        stream.getTracks().forEach((track) => {
            pc.addTrack(track, stream);
        });

        pcRef.current = pc;
        return pc;
    };

    const handleCopyLink = async () => {
        try {
            await navigator.clipboard.writeText(joinLink);
            setStatus('Join link copied');
        } catch (err) {
            console.log('copy link error', err);
        }
    };

    const handleStartCall = async () => {
        try {
            setStatus('Calling...');
            setIsCalling(true);

            const pc = await createPeerConnection();
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('offer', { roomId, offer });
        } catch (err) {
            console.log('start call error', err);
            stopStream();
            resetCallUi('Unable to start call');
        }
    };

    const handleAcceptCall = async () => {
        try {
            if (!pendingOfferRef.current) {
                return;
            }

            setIncomingCall(false);
            setStatus('Joining call...');

            const pc = await createPeerConnection();
            await pc.setRemoteDescription(pendingOfferRef.current);
            await flushQueuedCandidates();

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('answer', { roomId, answer });
        } catch (err) {
            console.log('accept call error', err);
            stopStream();
            resetCallUi('Unable to join call');
        }
    };

    const handleEndCall = () => {
        socket.emit('end-call', { roomId });
        socket.emit('leave-call', { roomId });
        stopStream();
        resetCallUi('Call ended');
        endCall();
    };

    useEffect(() => {
        syncRemoteAudioState();
    }, [isMuted]);

    useEffect(() => {
        socket.emit('join-call', { roomId });

        const handleParticipantJoined = () => {
            setPeerAvailable(true);
            setStatus('Someone joined this call link');
        };

        const handleOffer = ({ offer }) => {
            pendingOfferRef.current = offer;
            setIncomingCall(true);
            setPeerAvailable(true);
            setStatus('Incoming call');
        };

        const handleAnswer = async ({ answer }) => {
            try {
                if (!pcRef.current) {
                    return;
                }

                await pcRef.current.setRemoteDescription(answer);
                await flushQueuedCandidates();
                setStatus('Connecting...');
            } catch (err) {
                console.log('answer error', err);
            }
        };

        const handleIceCandidate = async ({ candidate }) => {
            try {
                if (!pcRef.current || !pcRef.current.remoteDescription) {
                    queuedCandidatesRef.current.push(candidate);
                    return;
                }

                await pcRef.current.addIceCandidate(candidate);
            } catch (err) {
                console.log('socket ice candidate error', err);
            }
        };

        const handleRemoteEndCall = () => {
            stopStream();
            resetCallUi('The other person ended the call');
            endCall();
        };

        socket.on('participant-joined', handleParticipantJoined);
        socket.on('offer', handleOffer);
        socket.on('answer', handleAnswer);
        socket.on('ice-candidate', handleIceCandidate);
        socket.on('call-ended', handleRemoteEndCall);

        return () => {
            socket.off('participant-joined', handleParticipantJoined);
            socket.off('offer', handleOffer);
            socket.off('answer', handleAnswer);
            socket.off('ice-candidate', handleIceCandidate);
            socket.off('call-ended', handleRemoteEndCall);
            socket.emit('leave-call', { roomId });
            stopStream();
        };
    }, [endCall, roomId]);


    const handlePip = async () => {
        const remoteVideo = remoteVideoRef.current;
        const remoteStream = remoteStreamRef.current ?? remoteVideo?.srcObject;

        if (!remoteVideo || !remoteStream) {
            return;
        }

        try {
            await remoteVideo.play();

            if ('documentPictureInPicture' in window) {
                if (pipWindowRef.current && !pipWindowRef.current.closed) {
                    await closePipWindow();
                    return;
                }

                const pipWindow = await window.documentPictureInPicture.requestWindow({
                    width: 420,
                    height: 320,
                });

                pipWindowRef.current = pipWindow;
                setIsPipActive(true);

                pipWindow.document.body.innerHTML = '';
                pipWindow.document.title = 'Call PiP';
                pipWindow.document.body.style.margin = '0';
                pipWindow.document.body.style.display = 'flex';
                pipWindow.document.body.style.flexDirection = 'column';
                pipWindow.document.body.style.background = '#020617';

                const pipContainer = pipWindow.document.createElement('div');
                pipContainer.style.display = 'flex';
                pipContainer.style.height = '100vh';
                pipContainer.style.flexDirection = 'column';

                const controls = pipWindow.document.createElement('div');
                controls.style.display = 'flex';
                controls.style.gap = '12px';
                controls.style.padding = '12px';
                controls.style.background = 'rgba(15, 23, 42, 0.95)';

                pipContainer.style.position = 'relative';
                remoteVideo.style.width = '100%';
                remoteVideo.style.flex = '1';
                remoteVideo.style.background = 'black';
                remoteVideo.style.objectFit = 'cover';
                remoteVideo.style.height = 'auto';
                remoteVideo.muted = isMuted;

                const muteButton = pipWindow.document.createElement('button');
                muteButton.textContent = isMuted ? 'Unmute' : 'Mute';
                muteButton.style.flex = '1';
                muteButton.style.border = 'none';
                muteButton.style.borderRadius = '999px';
                muteButton.style.padding = '10px 14px';
                muteButton.style.fontWeight = '700';
                muteButton.style.cursor = 'pointer';
                muteButton.onclick = handleToggleMute;
                pipMuteButtonRef.current = muteButton;

                const returnButton = pipWindow.document.createElement('button');
                returnButton.textContent = 'Return';
                returnButton.style.flex = '1';
                returnButton.style.border = '1px solid rgba(255,255,255,0.2)';
                returnButton.style.borderRadius = '999px';
                returnButton.style.padding = '10px 14px';
                returnButton.style.background = 'transparent';
                returnButton.style.color = 'white';
                returnButton.style.fontWeight = '700';
                returnButton.style.cursor = 'pointer';
                returnButton.onclick = () => {
                    closePipWindow();
                };
                pipReturnButtonRef.current = returnButton;

                const endCallButton = pipWindow.document.createElement('button');
                endCallButton.textContent = 'End Call';
                endCallButton.style.flex = '1';
                endCallButton.style.border = 'none';
                endCallButton.style.borderRadius = '999px';
                endCallButton.style.padding = '10px 14px';
                endCallButton.style.background = '#dc2626';
                endCallButton.style.color = 'white';
                endCallButton.style.fontWeight = '700';
                endCallButton.style.cursor = 'pointer';
                endCallButton.onclick = () => {
                    handleEndCall();
                };
                pipEndCallButtonRef.current = endCallButton;

                controls.appendChild(muteButton);
                controls.appendChild(returnButton);
                controls.appendChild(endCallButton);
                pipContainer.appendChild(remoteVideo);
                pipContainer.appendChild(controls);
                pipWindow.document.body.appendChild(pipContainer);
                remoteVideo.play().catch((err) => {
                    console.log('pip remote play error', err);
                });

                pipWindow.addEventListener('pagehide', () => {
                    pipMuteButtonRef.current = null;
                    pipReturnButtonRef.current = null;
                    pipEndCallButtonRef.current = null;
                    pipWindowRef.current = null;
                    setIsPipActive(false);
                }, { once: true });

                syncRemoteAudioState();
                return;
            }

            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
                setIsPipActive(false);
            } else {
                await remoteVideo.requestPictureInPicture();
                setIsPipActive(true);
            }
        }
        catch (err) {
            console.log(err);
        }
    };

    useEffect(() => {
        const handleLeavePictureInPicture = () => {
            setIsPipActive(false);
        };

        const remoteVideo = remoteVideoRef.current;
        remoteVideo?.addEventListener('leavePictureInPicture', handleLeavePictureInPicture);

        return () => {
            remoteVideo?.removeEventListener('leavePictureInPicture', handleLeavePictureInPicture);
        };
    }, []);

    return (
        <>
            <div className={isPipActive ? 'hidden' : 'block'}>
                <div className='mb-4 rounded-xl bg-white/15 p-4 text-white'>
                    <p className='text-sm font-semibold'>Room code: {roomId}</p>
                    <p className='mt-2 break-all text-sm'>{joinLink}</p>
                </div>
                <div className='mb-4 flex gap-3'>
                    <button className='bg-white text-slate-900 p-3 rounded-lg' onClick={handleCopyLink}>
                        Copy Join Link
                    </button>
                </div>
                <p className='mb-4 text-white font-medium'>{status}</p>
                <div className='relative w-full max-w-5xl overflow-hidden rounded-3xl border border-white/20 bg-slate-950/50 shadow-2xl'>
                    <div ref={videoStageRef} className='relative'>
                        <video
                            ref={remoteVideoRef}
                            autoPlay
                            playsInline
                            className='h-105 w-full bg-black object-cover md:h-130'
                        />
                    </div>
                    <div className='pointer-events-none absolute left-4 top-4 rounded-lg bg-black/60 px-3 py-1 text-sm font-semibold text-white'>
                        Remote Video
                    </div>
                    <div className='absolute bottom-4 right-4 w-40 overflow-hidden rounded-2xl border border-white/20 bg-slate-900 shadow-xl md:w-56'>
                        <div className='px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/80'>
                            Local Video
                        </div>
                        <video
                            ref={localVideoRef}
                            autoPlay
                            playsInline
                            muted
                            className='h-28 w-full bg-black object-cover md:h-36'
                        />
                    </div>
                </div>
            </div>
            {isPipActive && (
                <div className='w-full max-w-xl rounded-3xl border border-white/20 bg-slate-950/60 p-8 text-center text-white shadow-2xl'>
                    <p className='text-2xl font-semibold'>Call is in PiP window</p>
                    <p className='mt-3 text-sm text-white/75'>
                        The main call screen is hidden while picture-in-picture is active.
                    </p>
                </div>
            )}
            <div className='mt-6 flex flex-wrap gap-3'>
                <button
                    className='bg-green-600 text-white p-3 rounded-lg disabled:opacity-50'
                    disabled={!peerAvailable || incomingCall || isCalling || isInActiveCall}
                    onClick={handleStartCall}
                >
                    Start Call
                </button>
                {incomingCall && (
                    <button
                        className='bg-blue-600 text-white p-3 rounded-lg'
                        onClick={handleAcceptCall}
                    >
                        Accept Call
                    </button>
                )}
                <button
                    className='bg-amber-500 text-slate-950 p-3 rounded-lg font-semibold'
                    onClick={handleToggleMute}
                >
                    {isMuted ? 'Unmute' : 'Mute'}
                </button>
                <button className='bg-black text-white p-3 rounded-lg' onClick={handlePip}>
                    {isPipActive ? 'Close PiP' : 'PiP window'}
                </button>
                <button className='bg-red-600 text-white p-3 rounded-lg' onClick={handleEndCall}>
                    End Call
                </button>
            </div>
        </>
    )
}

export default CallScreen
