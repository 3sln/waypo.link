import {createLocalization,ObjectCatalogue} from './index.mjs';

const spanish={
 'Account deletion scheduled':'Eliminación de cuenta programada',
 'Account deletion reminder':'Recordatorio de eliminación de cuenta',
 'Account deletion started':'La eliminación de la cuenta ha comenzado',
 'Account deletion completed':'Cuenta eliminada',
 'Deletion of @{handle} is scheduled for {date}.':'La eliminación de @{handle} está programada para el {date}.',
 'Deletion of @{handle} has started. It can no longer be cancelled.':'La eliminación de @{handle} ha comenzado. Ya no se puede cancelar.',
 'Deletion of @{handle} is complete.':'La eliminación de @{handle} se ha completado.',
 'Not you? Cancel deletion.':'¿No has sido tú? Cancela la eliminación.',
 'Opening this link does not cancel deletion. Confirm on the page. This link cannot sign you in.':'Abrir este enlace no cancela la eliminación. Confirma en la página. Este enlace no permite iniciar sesión.',
 'To appeal this deletion, contact the service operator.':'Para apelar esta eliminación, contacta con el operador del servicio.',
 'Messages others received and files in connected storage remain with them. Your name will never be reassigned.':'Los mensajes recibidos por otras personas y los archivos en almacenamiento conectado permanecen allí. Tu nombre nunca se reasignará.',
 'Cancel account deletion':'Cancelar la eliminación de la cuenta',
 'Confirm to cancel the scheduled deletion. This does not sign you in.':'Confirma para cancelar la eliminación programada. Esto no inicia sesión.',
 'Cancel deletion':'Cancelar eliminación',
 'Deletion cancelled. You can sign in to review your account.':'Eliminación cancelada. Puedes iniciar sesión para revisar tu cuenta.',
 'This link is invalid or no longer available. Sign in to review your account.':'Este enlace no es válido o ya no está disponible. Inicia sesión para revisar tu cuenta.',
 'We could not confirm cancellation. Try again or sign in to review your account.':'No se pudo confirmar la cancelación. Inténtalo de nuevo o inicia sesión para revisar tu cuenta.',
 'JavaScript is required to use this link. You can also sign in to cancel deletion.':'Se necesita JavaScript para usar este enlace. También puedes iniciar sesión para cancelar la eliminación.',
 'Sign in':'Iniciar sesión'
};
export function deletionLocalization(locale='en'){return createLocalization({locale,catalogue:new ObjectCatalogue({'':String(locale).split('-')[0]==='es'?spanish:{}})});}
