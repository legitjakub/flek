import { z } from 'zod';
const required=z.string().trim().min(1,'Vyplňte prosím toto pole.');
const wholeCzk=z.string().regex(/^\d+$/,'Zadejte celé koruny.');
export const loginSchema=z.object({email:z.email('Zkontroluj e-mail.'),password:z.string().min(8,'Heslo musí mít alespoň 8 znaků.')});
export const profileSchema=z.object({first_name:required.max(80),last_name:required.max(80),phone:z.string().regex(/^\+?[\d\s]{9,20}$/,'Zkontroluj telefonní číslo.')});
export const businessSchema=z.object({display_name:required.min(2),category_slug:required,phone:required,public_email:z.email('Zkontrolujte e-mail.'),address_line:required,city:required,postal_code:required,latitude:required,longitude:required,description:z.string(),website:z.string()});
export const serviceSchema=z.object({name:required.min(2),category_slug:required,duration_minutes:z.string().regex(/^\d+$/,'Zadejte počet minut.'),price:wholeCzk,description:z.string()});
export const offerSchema=z.object({service_id:z.uuid('Vyberte službu.'),local_start:required,price:wholeCzk,capacity:z.string().regex(/^\d+$/,'Zadejte počet míst.'),cutoff_minutes:z.string().regex(/^\d+$/,'Zadejte počet minut.')});
export type OfferFormValues=z.infer<typeof offerSchema>;
