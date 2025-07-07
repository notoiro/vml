const notes = {
  'c':  0,
  'c+': 1, 'c#': 1, 'd-':  1,
  'd':  2,
  'd+': 3, 'd#': 3, 'e-':  3,
  'e':  4,
  'f':  5,
  'f+': 6, 'f#': 6, 'g-':  6,
  'g':  7,
  'g+': 8, 'g#': 8, 'a-':  8,
  'a':  9,
  'a+': 10, 'a#': 10, 'b-': 10,
  'b': 11
};

const split_mora = (text) => {
  let re = /[ウクスツヌフムユルグズヅブプうくすつぬふむゆるぐずづぶぷ][ァヮィェォぁゎぃぇぉ]|[キシチニヒミリギジヂビピテデきしちにひみりぎじぢびぴてで][ャュェョゃゅぇょ]|[テデてで][ィぃ]|[ァ-ヴーぁ-ゔー]/g;
  const matches = text.match(re);
  return matches || [];
};

class VMLError extends Error {
  constructor(message, type = 'UNKNOWN', position = null, context = null) {
    super(message);
    this.name = 'VMLError';
    this.type = type;
    this.position = position;
    this.context = context;
  }

  // エラー情報を構造化して返す
  toJSON() {
    return {
      name: this.name,
      type: this.type,
      message: this.message,
      position: this.position,
      context: this.context
    };
  }
}

// 具体的なエラー型
class VMLSyntaxError extends VMLError {
  constructor(message, position = null, context = null) {
    super(message, 'SYNTAX_ERROR', position, context);
    this.name = 'VMLSyntaxError';
  }
}

class VMLLyricsError extends VMLError {
  constructor(message, position = null, context = null) {
    super(message, 'LYRICS_ERROR', position, context);
    this.name = 'VMLLyricsError';
  }
}

class VMLMusicError extends VMLError {
  constructor(message, position = null, context = null) {
    super(message, 'MUSIC_ERROR', position, context);
    this.name = 'VMLMusicError';
  }
}

class VMLParseError extends VMLError {
  constructor(message, line = null, lineText = null, position = null, inheritance_error = null) {
    super(message, 'PARSE_ERROR', position, { line, lineText });
    this.name = 'VMLParseError';
    this.line = line;
    this.lineText = lineText;
    this.inheritance_error = inheritance_error;
  }
}

class VMLToken {
  constructor(type, value, position) {
    this.type = type;
    this.value = value;
    this.position = position;
  }
}

class VMLLexer {
  constructor(input) {
    this.input = input.toLowerCase().replace(/,/g, '');
    this.position = 0;
    this.tokens = [];
  }

  tokenize() {
    while (this.position < this.input.length) {
      const char = this.input[this.position];

      if (/[cdefgab]/.test(char)) {
        this.tokens.push(new VMLToken('NOTE', char, this.position));
      } else if (char === 'r') {
        this.tokens.push(new VMLToken('REST', char, this.position));
      } else if (char === 'o') {
        this.tokens.push(new VMLToken('OCTAVE', char, this.position));
      } else if (char === 't') {
        this.tokens.push(new VMLToken('TEMPO', char, this.position));
      } else if (/[+#]/.test(char)) {
        this.tokens.push(new VMLToken('SHARP', char, this.position));
      } else if (char === '-') {
        this.tokens.push(new VMLToken('FLAT', char, this.position));
      } else if (char === '>') {
        this.tokens.push(new VMLToken('OCTAVE_UP', char, this.position));
      } else if (char === '<') {
        this.tokens.push(new VMLToken('OCTAVE_DOWN', char, this.position));
      } else if (/[0-9]/.test(char)) {
        this.tokens.push(new VMLToken('NUMBER', char, this.position));
      } else if (char === '.') {
        this.tokens.push(new VMLToken('DOT', char, this.position));
      } else if (char === '^') {
        this.tokens.push(new VMLToken('TIE', char, this.position));
      } else if (char === ';') {
        this.tokens.push(new VMLToken('SEMICOLON', char, this.position));
      } else if (!/\s/.test(char)) {
        throw new VMLSyntaxError(
          `Unknown character '${char}'`,
          this.position,
          { character: char, surrounding: this.input.slice(Math.max(0, this.position - 5), this.position + 5) }
        );
      }

      this.position++;
    }

    this.tokens.push(new VMLToken('EOF', null, this.position));
    return this.tokens;
  }
}

class VMLParser {
  constructor(tokens, lyrics) {
    this.tokens = tokens;
    this.lyrics = lyrics;
    this.position = 0;
    this.currentToken = this.tokens[0];
    this.octave = 4;
    this.tempo = 120;
    this.lyricsIndex = 0;
  }

  advance() {
    this.position++;
    if (this.position < this.tokens.length) {
      this.currentToken = this.tokens[this.position];
    }
  }

  peek() {
    const nextPos = this.position + 1;
    return nextPos < this.tokens.length ? this.tokens[nextPos] : null;
  }

  expectToken(type) {
    if (this.currentToken.type !== type) {
      throw new VMLSyntaxError(
        `Expected ${type}, got ${this.currentToken.type}`,
        this.currentToken.position,
        { expected: type, actual: this.currentToken.type, value: this.currentToken.value }
      );
    }
    const token = this.currentToken;
    this.advance();
    return token;
  }

  parseNumber() {
    let number = '';
    while (this.currentToken.type === 'NUMBER') {
      number += this.currentToken.value;
      this.advance();
    }
    return parseInt(number, 10);
  }

  parseLength() {
    let length = '';

    // Parse base length (required)
    if (this.currentToken.type === 'NUMBER') {
      while (this.currentToken.type === 'NUMBER') {
        length += this.currentToken.value;
        this.advance();
      }
    } else {
      throw new VMLSyntaxError(
        'Expected length after note/rest',
        this.currentToken.position,
        { context: 'length_required' }
      );
    }

    // Parse dots
    while (this.currentToken.type === 'DOT') {
      length += '.';
      this.advance();
    }

    // Parse ties
    while (this.currentToken.type === 'TIE') {
      length += '^';
      this.advance();

      // After tie, expect another length
      if (this.currentToken.type === 'NUMBER') {
        while (this.currentToken.type === 'NUMBER') {
          length += this.currentToken.value;
          this.advance();
        }

        // Parse dots after tie
        while (this.currentToken.type === 'DOT') {
          length += '.';
          this.advance();
        }
      } else {
        throw new VMLSyntaxError(
          'Expected length after tie',
          this.currentToken.position,
          { context: 'tie_length_required' }
        );
      }
    }

    return length;
  }

  parseNote() {
    const noteToken = this.expectToken('NOTE');
    let noteName = noteToken.value;

    // Parse accidentals
    if (this.currentToken.type === 'SHARP') {
      noteName += '+';
      this.advance();
    } else if (this.currentToken.type === 'FLAT') {
      noteName += '-';
      this.advance();
    }

    // Validate note
    if (noteName === 'e+' || noteName === 'e#') {
      throw new VMLMusicError(
        `Invalid note: ${noteName} (E sharp does not exist)`,
        noteToken.position,
        { note: noteName, reason: 'invalid_note' }
      );
    }

    const length = this.parseLength();

    // Get lyric - check if we have enough lyrics
    if (this.lyricsIndex >= this.lyrics.length) {
      throw new VMLLyricsError(
        `Not enough lyrics for note '${noteName}'`,
        noteToken.position,
        {
          note: noteName,
          expectedLyrics: this.lyricsIndex + 1,
          actualLyrics: this.lyrics.length,
          reason: 'insufficient_lyrics'
        }
      );
    }

    const lyric = this.lyrics[this.lyricsIndex];
    this.lyricsIndex++;

    return {
      key: noteName,
      lyric: lyric,
      octave: this.octave,
      length: length
    };
  }

  parseRest() {
    this.expectToken('REST');
    const length = this.parseLength();

    return {
      key: null,
      lyric: '',
      octave: null,
      length: length
    };
  }

  parseOctave() {
    this.expectToken('OCTAVE');
    const octave = this.parseNumber();

    if (octave < 0 || octave > 9) {
      throw new VMLMusicError(
        `Octave out of range: ${octave}`,
        this.currentToken.position,
        { octave, validRange: '0-9', reason: 'octave_out_of_range' }
      );
    }

    this.octave = octave;
    return null; // Octave commands don't produce notes
  }

  parseTempo() {
    this.expectToken('TEMPO');
    const tempo = this.parseNumber();

    if (tempo <= 0) {
      throw new VMLMusicError(
        `Invalid tempo: ${tempo}`,
        this.currentToken.position,
        { tempo, reason: 'invalid_tempo' }
      );
    }

    this.tempo = tempo;
    return null; // Tempo commands don't produce notes
  }

  parseOctaveChange() {
    if (this.currentToken.type === 'OCTAVE_UP') {
      this.octave++;
      this.advance();
    } else if (this.currentToken.type === 'OCTAVE_DOWN') {
      this.octave--;
      this.advance();
    }
    return null;
  }

  parseCommand() {
    switch (this.currentToken.type) {
      case 'NOTE':
        return this.parseNote();
      case 'REST':
        return this.parseRest();
      case 'OCTAVE':
        return this.parseOctave();
      case 'TEMPO':
        return this.parseTempo();
      case 'OCTAVE_UP':
      case 'OCTAVE_DOWN':
        return this.parseOctaveChange();
      case 'EOF':
        return null;
      default:
        throw new VMLSyntaxError(
          `Unexpected token ${this.currentToken.type}`,
          this.currentToken.position,
          { tokenType: this.currentToken.type, tokenValue: this.currentToken.value }
        );
    }
  }

  parse() {
    const track = [];

    while (this.currentToken.type !== 'EOF') {
      const command = this.parseCommand();
      if (command !== null) {
        track.push(command);
      }
    }

    // Check if all lyrics were consumed
    if (this.lyricsIndex < this.lyrics.length) {
      throw new VMLLyricsError(
        'Too many lyrics provided',
        null,
        {
          unusedLyrics: this.lyrics.slice(this.lyricsIndex),
          expectedLyrics: this.lyricsIndex,
          actualLyrics: this.lyrics.length,
          reason: 'excess_lyrics'
        }
      );
    }

    return {
      tempo: this.tempo,
      track: track,
      last_octave: this.octave
    };
  }
}

class VML {
  constructor(frame_rate = 93.75) {
    this.frame_rate = frame_rate;
  }

  parse_line(text, octave = 4) {
    const colonIndex = text.indexOf(':');
    if (colonIndex === -1) {
      throw new VMLSyntaxError(
        'Invalid line format',
        0,
        { expected: 'lyrics:notes', actual: text, reason: 'missing_colon' }
      );
    }

    const lyricsText = text.substring(0, colonIndex);
    const notesText = text.substring(colonIndex + 1);

    if (!lyricsText.trim()) {
      throw new VMLSyntaxError(
        'Empty lyrics section',
        0,
        { reason: 'empty_lyrics' }
      );
    }

    if (!notesText.trim()) {
      throw new VMLSyntaxError(
        'Empty notes section',
        colonIndex + 1,
        { reason: 'empty_notes' }
      );
    }

    const lyrics = split_mora(lyricsText);

    try {
      const lexer = new VMLLexer(notesText);
      const tokens = lexer.tokenize();
      const parser = new VMLParser(tokens, lyrics);

      // Set initial octave
      parser.octave = octave;

      return parser.parse();
    } catch (error) {
      // Re-throw with additional context if it's a VML error
      if (error instanceof VMLError) {
        throw error;
      } else {
        throw new VMLParseError(
          `Parsing failed: ${error.message}`,
          null,
          text,
          null
        );
      }
    }
  }

  parse(text) {
    const result = [];
    let tempo = 120;
    let octave = 4;

    const lines = text.replace(/\n/g, '').split(';').filter(line => line.trim());

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const parsed = this.parse_line(line, octave);

        if (i === 0) {
          tempo = parsed.tempo;
        }

        octave = parsed.last_octave;
        result.push(parsed.track);
      } catch (error) {
        if (error instanceof VMLError) {
          throw new VMLParseError(
            `Error in line ${i + 1}: ${error.message}`,
            i + 1,
            line,
            error.position,
            error
          );
        } else {
          throw new VMLParseError(
            `Unexpected error in line ${i + 1}: ${error.message}`,
            i + 1,
            line,
            null
          );
        }
      }
    }

    return {
      tempo,
      tracks: result
    };
  }

  parse_voicevox(text, key_range_fix = 0) {
    const song = this.parse(text);

    // Add initial rest (fixed 4分)
    song.tracks[0].unshift({ key: null, lyric: "", octave: null, length: "4" });

    const tracks = [];
    let time = 0;
    let ms_time = 0;

    for (const track of song.tracks) {
      for (const note of track) {
        const ms = this.calc_ms(note.length, song.tempo);
        const frame_length = this.calc_frame(ms);

        if (note.key !== null) {
          tracks.push({
            key: this.note_to_midi(note.key, note.octave, key_range_fix),
            lyric: note.lyric,
            frame_length,
            pos: time,
            ms_pos: ms_time,
            ms
          });
        }

        time += frame_length;
        ms_time += ms;
      }
    }

    // Group notes by continuity
    const result = [];
    let current_arr = {
      distance: this.calc_frame(this.calc_ms('4', song.tempo)),
      notes: []
    };

    for (let i = 0; i < tracks.length; i++) {
      const current = tracks[i];
      const next = tracks[i + 1];

      current_arr.notes.push(current);

      if (next && next.pos !== (current.pos + current.frame_length)) {
        result.push(current_arr);
        current_arr = {
          distance: next.pos - (current.pos + current.frame_length),
          notes: []
        };
      }
    }

    result.push(current_arr);
    song.tracks = result;

    return song;
  }

  note_to_midi(note, octave, key_range_fix = 0) {
    if (note === null) return null;

    const noteValue = notes[note];
    if (noteValue === undefined) {
      throw new VMLMusicError(
        `Invalid note: ${note}`,
        null,
        { note, reason: 'unknown_note' }
      );
    }

    const midiNote = noteValue + (octave + 1) * 12 + key_range_fix;

    // MIDI note range validation (0-127)
    if (midiNote < 0 || midiNote > 127) {
      throw new VMLMusicError(
        `MIDI note out of range: ${midiNote}`,
        null,
        { note, octave, midiNote, validRange: '0-127', reason: 'midi_out_of_range' }
      );
    }

    return midiNote;
  }

  calc_ms(score_length, bpm = 120) {
    let result = 0;

    for (const segment of score_length.split('^')) {
      let length;
      let dot = false;

      if (segment.includes('.')) {
        length = parseInt(segment.replace('.', ''), 10);
        dot = true;
      } else {
        length = parseInt(segment, 10);
      }

      if (isNaN(length) || length <= 0) {
        throw new VMLMusicError(
          `Invalid note length: ${segment}`,
          null,
          { segment, scoreLength: score_length, reason: 'invalid_length' }
        );
      }

      let ms = 240 / bpm / length * 1000;

      if (dot) {
        ms *= 1.5;
      }

      result += ms;
    }

    return result;
  }

  calc_frame(ms) {
    return Math.round(ms * this.frame_rate / 1000);
  }
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VML,
    VMLError,
    VMLSyntaxError,
    VMLLyricsError,
    VMLMusicError,
    VMLParseError
  };
}

// Export for browser
if (typeof window !== 'undefined') {
  window.VML = VML;
  window.VMLError = VMLError;
  window.VMLSyntaxError = VMLSyntaxError;
  window.VMLLyricsError = VMLLyricsError;
  window.VMLMusicError = VMLMusicError;
  window.VMLParseError = VMLParseError;
}
