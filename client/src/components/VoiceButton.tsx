import { Mic, MicOff, Loader2, Volume2 } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";

type VoiceState = 'idle' | 'recording' | 'processing';

interface VoiceButtonProps {
  onVoiceMessage: (transcript: string, response: string, audioBase64?: string, products?: any[]) => void;
  onError: (error: string) => void;
  disabled?: boolean;
  chatColor: string;
  chatColorEnd: string;
}

export function VoiceButton({ 
  onVoiceMessage, 
  onError, 
  disabled = false,
  chatColor,
  chatColorEnd 
}: VoiceButtonProps) {
  const [state, setState] = useState<VoiceState>('idle');
  const [audioLevel, setAudioLevel] = useState(0);
  const [isSupported, setIsSupported] = useState(true);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setIsSupported(false);
      setHasPermission(false);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  const visualizeAudio = (stream: MediaStream) => {
    audioContextRef.current = new AudioContext();
    analyserRef.current = audioContextRef.current.createAnalyser();
    const source = audioContextRef.current.createMediaStreamSource(stream);
    
    analyserRef.current.fftSize = 256;
    source.connect(analyserRef.current);
    
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const updateLevel = () => {
      if (!analyserRef.current) return;
      
      analyserRef.current.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / bufferLength;
      setAudioLevel(average / 255);
      
      animationFrameRef.current = requestAnimationFrame(updateLevel);
    };
    
    updateLevel();
  };

  const startRecording = async () => {
    if (!isSupported) {
      onError("Your browser doesn't support audio recording. Please use a modern browser like Chrome, Firefox, or Edge.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        } 
      });
      
      setHasPermission(true);
      
      const options = { mimeType: 'audio/webm;codecs=opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'audio/webm';
      }
      
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      visualizeAudio(stream);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        
        if (audioContextRef.current) {
          audioContextRef.current.close();
        }
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        setAudioLevel(0);
        
        await processRecording();
      };

      mediaRecorder.start();
      setState('recording');
      
    } catch (error: any) {
      console.error('Error accessing microphone:', error);
      setHasPermission(false);
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        onError("Microphone access denied. Please allow microphone permissions in your browser settings.");
      } else if (error.name === 'NotFoundError') {
        onError("No microphone found. Please connect a microphone and try again.");
      } else {
        onError("Failed to access microphone. Please check your browser settings.");
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setState('processing');
    }
  };

  const processRecording = async () => {
    try {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64Audio = (reader.result as string).split(',')[1];
          
          const response = await fetch('/api/voice/process', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ 
              audioData: base64Audio,
              returnAudio: true
            })
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(errorData.error || `Server error: ${response.status}`);
          }

          const data = await response.json();
          onVoiceMessage(data.transcript, data.response, data.audio, data.products);
          setState('idle');
        } catch (error: any) {
          console.error('Voice processing error:', error);
          onError(error.message || 'Failed to process voice message');
          setState('idle');
        }
      };
      
      reader.readAsDataURL(audioBlob);
      
    } catch (error: any) {
      console.error('Error processing recording:', error);
      onError(error.message || 'Failed to process voice message');
      setState('idle');
    }
  };

  const handleClick = () => {
    if (state === 'idle') {
      startRecording();
    } else if (state === 'recording') {
      stopRecording();
    }
  };

  if (!isSupported || hasPermission === false) {
    return null;
  }

  const getButtonStyle = () => {
    if (state === 'recording') {
      return {
        background: `linear-gradient(to right, ${chatColor}, ${chatColorEnd})`,
        boxShadow: `0 0 0 ${4 + audioLevel * 8}px rgba(147, 51, 234, ${0.3 + audioLevel * 0.3})`,
      };
    }
    return {
      background: `linear-gradient(to right, ${chatColor}, ${chatColorEnd})`,
    };
  };

  return (
    <div className="relative flex items-center gap-2">
      <Button
        size="icon"
        onClick={handleClick}
        disabled={disabled || state === 'processing'}
        className={`h-12 w-12 rounded-xl shadow-md flex-shrink-0 transition-all duration-300 ${
          state === 'recording' ? 'animate-pulse' : ''
        }`}
        style={getButtonStyle()}
        title={state === 'idle' ? 'Click to record voice message' : state === 'recording' ? 'Click to stop recording' : 'Processing...'}
      >
        {state === 'processing' ? (
          <Loader2 className="w-5 h-5 animate-spin text-white" />
        ) : state === 'recording' ? (
          <MicOff className="w-5 h-5 text-white" />
        ) : (
          <Mic className="w-5 h-5 text-white" />
        )}
      </Button>
      
      {state === 'recording' && (
        <div className="flex items-center gap-1">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="w-1 bg-gradient-to-t rounded-full transition-all duration-100"
              style={{
                background: `linear-gradient(to top, ${chatColor}, ${chatColorEnd})`,
                height: `${8 + audioLevel * 32 * (1 + Math.sin(Date.now() / 100 + i) * 0.5)}px`,
                opacity: 0.6 + audioLevel * 0.4
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
