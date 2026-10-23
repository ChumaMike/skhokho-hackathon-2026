import type { ReactNode } from "react";
import type { SetupStep } from "./types";
import s from "./connected.module.css";
import Link from "next/link";

/** Presentation-only shell: place EXISTING join form/design wizard within formSlot. */
export function ConnectedSetup({steps,heading,description,formSlot,previewSlot}: {
 steps:SetupStep[];heading:string;description:string;formSlot:ReactNode;previewSlot:ReactNode;
}) {
 return <div className={`${s.root} ${s.setup}`}>
   <aside className={s.setupNav}><div className={s.brand}><span className={s.brandIcon}>✺</span>Skhokho</div>
     <p className={s.small}>Your business, online and ready.</p><nav className={s.setupSteps} aria-label="Setup progress">
       {steps.map((step,i)=><Link key={step.id} className={s.setupStep} data-state={step.state} href={step.href}
         aria-current={step.state==="current"?"step":undefined}>
         <strong>{i+1}. {step.label}</strong>{step.detail&&<span className={s.setupStepDetail}>{step.detail}</span>}</Link>)}
     </nav></aside>
   <main className={s.setupMain}><div className={s.eyebrow}>Start with what you need</div>
     <h1 className={`${s.display} ${s.pageTitle}`}>{heading}</h1><p className={s.pageLead}>{description}</p>
     <div className={s.formSlot}>{formSlot}</div></main>
   <aside className={s.setupPreview}><div className={s.eyebrow}>Your storefront</div>
     <h2>See it come together.</h2><div className={s.setupPreviewCard}>{previewSlot}</div>
     <p className={s.muted}>Preview only. Nothing is published until you choose to publish it.</p></aside>
 </div>;
}

export function ConnectedStorefrontEditor({title,editorSlot,previewSlot,previewHref}: {
 title?:string;editorSlot:ReactNode;previewSlot:ReactNode;previewHref?:string;
}) {
 return <main className={`${s.root} ${s.page}`}><div className={s.pageHeader}>
   <div><div className={s.eyebrow}>Your store</div><h1 className={`${s.display} ${s.pageTitle}`}>{title??"Make it yours."}</h1>
   <p className={s.pageLead}>Edit your business identity and see what customers will experience.</p></div>
   {previewHref&&<Link className={s.button} href={previewHref}>Full preview <span aria-hidden="true">↗</span></Link>}</div>
   <div className={s.editorGrid}><section className={s.editorPanel}>{editorSlot}</section>
     <aside className={s.editorPreview} aria-label="Storefront preview">{previewSlot}</aside></div>
 </main>;
}
