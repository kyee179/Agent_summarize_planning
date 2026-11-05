import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JournalWorkspace } from './features/JournalWorkspace.jsx';
import { AnalysisOptions } from './components/AnalysisOptions.jsx';
import { textCount } from './lib/text.js';
afterEach(cleanup);
describe('Chinese journal input',()=>{
  it('counts Chinese and emoji as characters rather than a single whitespace-delimited word',()=>{
    expect(textCount('项目报告')).toEqual({count:4,unit:'characters'});
    expect(textCount('中文👨‍👩‍👧‍👦')).toEqual({count:3,unit:'characters'});
    expect(textCount('Update my CV.')).toEqual({count:3,unit:'words'});
  });
  it('preserves mixed input and prevents submit/prepare while an IME composition is active',()=>{
    const save=vi.fn(),prepare=vi.fn();
    function Editor(){const [journal,setJournal]=useState({id:'j',title:'合成日记',content:'',journalDate:'2030-01-07',type:'daily',tags:[]});return <JournalWorkspace workspace={{journal,journals:[],busy:false,dirty:true,journalState:'Unsaved changes',phase:'idle',options:{},changeJournal:patch=>setJournal(current=>({...current,...patch})),save}} onPrepare={prepare}/>;}
    render(<Editor/>); const area=screen.getByLabelText('Journal text');
    fireEvent.compositionStart(area);fireEvent.change(area,{target:{value:'我需要更新ＣＶ。😀'}});
    expect(screen.getByRole('button',{name:'Save journal'})).toBeDisabled();fireEvent.submit(area.closest('form'));expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('button',{name:'Prepare plan'})).toBeDisabled();fireEvent.compositionEnd(area);
    expect(area).toHaveValue('我需要更新ＣＶ。😀');fireEvent.click(screen.getByRole('button',{name:'Save journal'}));expect(save).toHaveBeenCalledOnce();
  });
  it('offers output-language selection without changing interface labels or source permissions',()=>{
    const change=vi.fn();render(<AnalysisOptions options={{targetDate:'2030-01-07',allowMemory:false,allowWebResearch:false,includeActivity:false}} settings={{timezone:'UTC',aiProvider:'local',defaultAvailability:[]}} status={{}} onChange={change} onClose={()=>{}}/>);
    fireEvent.change(screen.getByLabelText('Analysis language'),{target:{value:'zh-CN'}});
    expect(change).toHaveBeenCalledWith(expect.objectContaining({outputLanguage:'zh-CN',allowMemory:false,allowWebResearch:false,includeActivity:false}));
  });
  it('finds full-width technical words in the journal library',()=>{
    const journal={id:'j',title:'接口ＡＰＩ',content:'项目报告',journalDate:'2030-01-07',type:'daily'};
    render(<JournalWorkspace workspace={{journal,journals:[journal],options:{},busy:false}}/>);
    fireEvent.change(screen.getByPlaceholderText('Search entries'),{target:{value:'API'}});
    expect(screen.getByRole('button',{name:/接口ＡＰＩ/})).toBeInTheDocument();
  });
});
